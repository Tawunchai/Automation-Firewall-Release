"""Checking a firewall's SSH host key before the worker sends it a password.

What these tests are really about: netmiko's default is to accept whatever answers on port 22, so
every scheduled backup and every config push used to hand a firewall administrator's password to
any machine that could answer for the device's address. ``host_keys.py`` closes that, and the cases
below are the ones where it must REFUSE — plus the two agreements that make the refusal real:

* the fingerprint has to be spelled exactly as Go's ``ssh.FingerprintSHA256`` spells it, because
  the two halves of this system compare those strings in one database table; and
* the netmiko session has to be pinned to the key the backend approved, not merely preceded by a
  check of it — otherwise anything able to answer twice shows a good key to the probe and its own
  to the session that carries the password.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import unittest
import urllib.error
from unittest import mock

from stub_modules import install_netmiko_stub, install_paramiko_stub

install_paramiko_stub()
# connect_checked imports netmiko lazily and these tests patch netmiko.ConnectHandler, which
# mock.patch can only do if the module is importable.
install_netmiko_stub()

import host_keys  # noqa: E402


class _Key:
    """A host key. ``asbytes`` is all the fingerprint is computed from."""

    def __init__(self, raw: bytes = b"ssh-ed25519-wire-format-bytes", name: str = "ssh-ed25519"):
        self._raw = raw
        self._name = name

    def asbytes(self) -> bytes:
        return self._raw

    def get_name(self) -> str:
        return self._name


def _response(payload: dict):
    body = json.dumps(payload).encode()
    cm = mock.MagicMock()
    cm.__enter__.return_value = io.BytesIO(body)
    cm.__exit__.return_value = False
    return cm


def _http_error(code: int, body: str = ""):
    return urllib.error.HTTPError(
        url="http://backend:9000/internal/ssh-host-key", code=code,
        msg="err", hdrs=None, fp=io.BytesIO(body.encode()),
    )


class Fingerprint(unittest.TestCase):
    """The one format agreement in this file that is not negotiable.

    Go computes `SHA256:` + base64(sha256(key bytes)) with the `=` padding stripped. If Python
    produced anything else, every device would look like a mismatch on its second connection —
    or, worse, be pinned a second time under a different-looking fingerprint.
    """

    def test_matches_the_openssh_and_go_spelling(self):
        raw = b"a-host-key"
        want = "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
        self.assertEqual(host_keys.fingerprint_sha256(_Key(raw)), want)

    def test_has_no_base64_padding(self):
        # ssh-keygen and Go both strip it; a trailing "=" would make the strings unequal while the
        # keys were identical.
        fp = host_keys.fingerprint_sha256(_Key(b"x"))
        self.assertTrue(fp.startswith("SHA256:"))
        self.assertNotIn("=", fp)

    def test_a_different_key_gives_a_different_fingerprint(self):
        self.assertNotEqual(
            host_keys.fingerprint_sha256(_Key(b"one")),
            host_keys.fingerprint_sha256(_Key(b"two")),
        )


class Verdicts(unittest.TestCase):
    def _verify(self, payload, key=None):
        key = key or _Key()
        with mock.patch.object(host_keys, "probe_host_key", return_value=key), \
                mock.patch.object(host_keys.urllib.request, "urlopen",
                                  return_value=_response(payload)):
            return host_keys.verify_host_key("10.10.20.90", 22)

    def test_a_matching_key_is_approved(self):
        key = _Key()
        self.assertIs(self._verify({"verdict": "match"}, key), key)

    def test_a_first_sighting_is_pinned_and_approved(self):
        key = _Key()
        self.assertIs(self._verify({"verdict": "pinned"}, key), key)

    def test_a_changed_key_is_refused_and_names_both_fingerprints(self):
        with self.assertRaises(host_keys.HostKeyError) as cm:
            self._verify({"verdict": "mismatch", "expected": "SHA256:theOldOne"})
        msg = str(cm.exception)
        self.assertIn("SHA256:theOldOne", msg, "the operator cannot compare without the expected value")
        self.assertIn("has changed", msg)
        # The message has to say that a firmware upgrade looks identical, or an operator who just
        # upgraded will read it as a break-in and vice versa.
        self.assertIn("firmware upgrade", msg)

    def test_an_unknown_verdict_is_refused_rather_than_assumed_good(self):
        # A backend that answered something this worker does not understand must not be read as
        # approval — that is the whole failure mode this module exists to remove.
        for payload in ({}, {"verdict": None}, {"verdict": "probably-fine"}, {"verdict": "MATCH"}):
            with self.subTest(payload=payload):
                with self.assertRaises(host_keys.HostKeyError):
                    self._verify(payload)

    def test_the_request_carries_the_worker_secret_and_the_measured_key(self):
        key = _Key(b"wire", "ecdsa-sha2-nistp256")
        with mock.patch.object(host_keys, "probe_host_key", return_value=key), \
                mock.patch.object(host_keys.urllib.request, "urlopen",
                                  return_value=_response({"verdict": "match"})) as up:
            host_keys.verify_host_key("10.10.20.90", 2222)

        req = up.call_args[0][0]
        self.assertEqual(req.get_header("X-worker-secret"), host_keys.WORKER_SECRET)
        body = json.loads(req.data.decode())
        self.assertEqual(body["host"], "10.10.20.90")
        self.assertEqual(body["port"], 2222)
        self.assertEqual(body["key_type"], "ecdsa-sha2-nistp256")
        self.assertEqual(body["fingerprint"], host_keys.fingerprint_sha256(key))


class BackendFailures(unittest.TestCase):
    """Every one of these must fail the job. None of them may fall through to a connection."""

    def _ask(self, exc):
        with mock.patch.object(host_keys.urllib.request, "urlopen", side_effect=exc):
            with self.assertRaises(host_keys.HostKeyError) as cm:
                host_keys._ask_backend("10.10.20.90", 22, "ssh-ed25519", "SHA256:x")
        return str(cm.exception)

    def test_a_rejected_worker_secret_says_which_setting_is_wrong(self):
        for code in (401, 403):
            with self.subTest(code=code):
                self.assertIn("WORKER_SHARED_SECRET", self._ask(_http_error(code)))

    def test_an_unconfigured_backend_blames_the_console_not_the_firewall(self):
        # 503 is the backend saying it has no host-key store. An operator told "the device's key
        # changed" would go and check the firewall, which is not where the problem is.
        msg = self._ask(_http_error(503))
        self.assertIn("misconfiguration", msg)

    def test_an_unreachable_backend_is_an_error_not_a_pass(self):
        self.assertIn("could not reach", self._ask(OSError("connection refused")))


class KnownHostsFile(unittest.TestCase):
    """The entry name. paramiko looks a host up by it, and ssh_strict=True means a name that does
    not match refuses the connection to a device that is perfectly fine."""

    def _entry(self, port):
        key = _Key()
        path = host_keys.write_known_hosts("10.10.20.90", port, key)
        try:
            self.assertTrue(os.path.isfile(path), "netmiko only loads alt_key_file if it exists")
            with open(path, encoding="utf-8") as fh:
                return fh.read().split()[0]
        finally:
            os.unlink(path)

    def test_port_22_is_a_bare_hostname(self):
        self.assertEqual(self._entry(22), "10.10.20.90")

    def test_any_other_port_is_bracketed(self):
        self.assertEqual(self._entry(2222), "[10.10.20.90]:2222")


class ConnectChecked(unittest.TestCase):
    def test_no_session_is_opened_when_the_key_is_refused(self):
        """The test that matters most: a refused key must cost nothing.

        If connect_checked reached ConnectHandler anyway, the password would be on the wire — and
        it would also spend one of the three tries FortiOS allows before it locks the account.
        """
        opened = []
        with mock.patch.object(host_keys, "verify_host_key",
                               side_effect=host_keys.HostKeyError("changed")), \
                mock.patch("netmiko.ConnectHandler", side_effect=lambda **kw: opened.append(kw)):
            with self.assertRaises(host_keys.HostKeyError):
                host_keys.connect_checked(host="10.10.20.90", device_type="fortinet",
                                          username="admin", password="secret")
        self.assertEqual(opened, [], "a session was opened for a device whose key was refused")

    def test_the_session_is_pinned_to_the_approved_key(self):
        """Verifying first is not enough — the probe and the session are two TCP connections.

        Without ssh_strict and a known_hosts file naming the approved key, anything able to answer
        twice presents a good key to the probe and its own to the session carrying the password.
        """
        captured = {}
        seen_file = {}

        def fake_connect(**kw):
            captured.update(kw)
            # Read it here, inside the call: connect_checked deletes the file afterwards.
            seen_file["exists"] = os.path.isfile(kw["alt_key_file"])
            with open(kw["alt_key_file"], encoding="utf-8") as fh:
                seen_file["body"] = fh.read()
            return "a-connection"

        with mock.patch.object(host_keys, "verify_host_key", return_value=_Key()), \
                mock.patch("netmiko.ConnectHandler", side_effect=fake_connect):
            conn = host_keys.connect_checked(host="10.10.20.90", port=22, device_type="fortinet",
                                             username="admin", password="secret")

        self.assertEqual(conn, "a-connection")
        self.assertIs(captured["ssh_strict"], True, "without this paramiko adds the key instead of refusing")
        self.assertIs(captured["alt_host_keys"], True)
        self.assertIs(captured["system_host_keys"], False,
                      "the container's own known_hosts is not this system's store")
        self.assertTrue(seen_file["exists"])
        self.assertIn("10.10.20.90", seen_file["body"])
        # The caller's own arguments survive untouched.
        self.assertEqual(captured["device_type"], "fortinet")
        self.assertEqual(captured["username"], "admin")
        self.assertEqual(captured["port"], 22)

    def test_the_known_hosts_file_is_cleaned_up(self):
        paths = []

        def fake_connect(**kw):
            paths.append(kw["alt_key_file"])
            return "c"

        with mock.patch.object(host_keys, "verify_host_key", return_value=_Key()), \
                mock.patch("netmiko.ConnectHandler", side_effect=fake_connect):
            host_keys.connect_checked(host="10.10.20.90", device_type="fortinet",
                                      username="u", password="p")
        self.assertFalse(os.path.exists(paths[0]), "one file per connection, and this worker runs for weeks")

    def test_a_missing_port_defaults_to_22(self):
        captured = {}
        with mock.patch.object(host_keys, "verify_host_key", return_value=_Key()) as verify, \
                mock.patch("netmiko.ConnectHandler", side_effect=lambda **kw: captured.update(kw)):
            host_keys.connect_checked(host="10.10.20.90", device_type="fortinet",
                                      username="u", password="p")
        self.assertEqual(captured["port"], 22)
        verify.assert_called_once_with("10.10.20.90", 22)

    def test_a_port_of_none_defaults_to_22(self):
        # worker.py reads the port off the job message, which may carry null.
        captured = {}
        with mock.patch.object(host_keys, "verify_host_key", return_value=_Key()), \
                mock.patch("netmiko.ConnectHandler", side_effect=lambda **kw: captured.update(kw)):
            host_keys.connect_checked(host="10.10.20.90", port=None, device_type="fortinet",
                                      username="u", password="p")
        self.assertEqual(captured["port"], 22)


if __name__ == "__main__":
    unittest.main()
