"""Checking a firewall's SSH host key before this worker sends it a password.

netmiko's default is to accept whatever answers on port 22. Every scheduled backup and every
config push therefore handed a firewall administrator's password, in clear, to any machine that
could answer for the device's address — the one place where a passive position on the management
network turns into full control of a firewall.

The Go side has refused that since Phase 2 (``backend/services/sshhostkey.go``): trust on first
use, one pin per ``host:port``, and a changed key is refused every time. This module gives the
worker the same rule and, deliberately, the SAME pins — it asks the backend rather than keeping a
known_hosts file of its own, because two stores can disagree about which firewall is known.

How one connection goes:

1. open a bare socket and read the host key. No credentials are sent, so an unknown or hostile key
   costs nothing — not even one of the three tries FortiOS allows before it locks an admin account.
2. ask the backend (``POST /internal/ssh-host-key``) what that fingerprint means. The backend
   pins it on first sight, confirms it on later ones, and refuses a changed one.
3. write that exact key to a throwaway known_hosts file and let netmiko connect with
   ``ssh_strict=True`` against it.

Step 3 is not redundant. Steps 1 and 2 verify a DIFFERENT TCP connection from the one that carries
the password; without pinning the real session to the key we just approved, anything able to answer
twice could present a good key to the probe and its own to netmiko.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import tempfile
import urllib.error
import urllib.request

import paramiko

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:9000").rstrip("/")
WORKER_SECRET = os.environ.get("WORKER_SHARED_SECRET", "")

HOST_KEY_PATH = "/internal/ssh-host-key"

# The verdicts the backend returns. Same three words as services.HostKeyVerdict* in Go.
VERDICT_PINNED = "pinned"
VERDICT_MATCH = "match"
VERDICT_MISMATCH = "mismatch"


class HostKeyError(RuntimeError):
    """The host key could not be trusted. The job fails with this as its reason."""


def fingerprint_sha256(key: paramiko.PKey) -> str:
    """The fingerprint in the form OpenSSH prints, e.g. ``SHA256:1Hd8…``.

    It has to match Go's ``ssh.FingerprintSHA256`` byte for byte, because the two halves of this
    system compare strings in one table. Both are the base64 of the SHA-256 of the wire-format
    public key with the trailing ``=`` padding stripped.
    """
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


def probe_host_key(host: str, port: int = 22, timeout: int = 15) -> paramiko.PKey:
    """Read the host key off ``host:port`` without authenticating.

    paramiko.Transport completes the key exchange and stops there: no username, no password, no
    auth attempt of any kind. That is the whole point — the key is examined before anything worth
    stealing is on the wire.
    """
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        raise HostKeyError(f"could not reach {host}:{port} to read its SSH host key: {e}") from e

    transport = paramiko.Transport(sock)
    try:
        transport.start_client(timeout=timeout)
        key = transport.get_remote_server_key()
    except Exception as e:  # noqa: BLE001 — paramiko raises several unrelated types here
        raise HostKeyError(f"could not read the SSH host key of {host}:{port}: {e}") from e
    finally:
        # close() owns the socket paramiko was handed, so the socket is not closed separately.
        transport.close()

    if key is None:
        raise HostKeyError(f"{host}:{port} presented no SSH host key")
    return key


def _ask_backend(host: str, port: int, key_type: str, fingerprint: str, timeout: int = 10) -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}{HOST_KEY_PATH}",
        data=json.dumps(
            {"host": host, "port": port, "key_type": key_type, "fingerprint": fingerprint}
        ).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Worker-Secret": WORKER_SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        if e.code in (401, 403):
            raise HostKeyError(
                "the backend rejected this worker when checking the device's SSH host key — "
                "WORKER_SHARED_SECRET does not match the backend's"
            ) from e
        if e.code == 503:
            raise HostKeyError(
                "the backend cannot check SSH host keys right now, so this worker will not send "
                "the device's password — this is a console misconfiguration, not a problem with "
                "the firewall"
            ) from e
        raise HostKeyError(
            f"could not check the device's SSH host key (HTTP {e.code}): {detail}"
        ) from e
    except HostKeyError:
        raise
    except Exception as e:  # noqa: BLE001
        raise HostKeyError(f"could not reach the backend to check the SSH host key: {e}") from e


def verify_host_key(host: str, port: int = 22) -> paramiko.PKey:
    """Probe ``host:port``, have the backend judge the key, and return the approved key.

    Raises HostKeyError on anything short of approval — including a key that merely changed, which
    is indistinguishable from an interception and is treated as one. A firmware upgrade that
    regenerated the key lands here too; clearing the stored pin is a deliberate act by an
    administrator who has compared the fingerprint on the device's own console.
    """
    key = probe_host_key(host, port)
    fp = fingerprint_sha256(key)

    body = _ask_backend(host, port, key.get_name(), fp)
    verdict = body.get("verdict")

    if verdict in (VERDICT_MATCH, VERDICT_PINNED):
        return key
    if verdict == VERDICT_MISMATCH:
        raise HostKeyError(
            f"the SSH host key for {host}:{port} has changed.\n"
            f"  expected: {body.get('expected') or 'unknown'}\n"
            f"  received: {fp}\n"
            "Refusing to send the device password. This is what an intercepted connection looks "
            "like; it is also what a firmware upgrade that regenerated the key looks like. "
            "Compare the fingerprint on the device's own console, and if it is genuinely the new "
            "one, an administrator can clear the stored key for this host."
        )
    raise HostKeyError(
        f"the backend gave no usable verdict for the SSH host key of {host}:{port}: {verdict!r}"
    )


def write_known_hosts(host: str, port: int, key: paramiko.PKey) -> str:
    """Write ``key`` to a throwaway known_hosts file and return its path.

    Built through paramiko's own HostKeys so the entry is spelled the way paramiko will look it up:
    a bare hostname on port 22, and ``[host]:port`` on any other port. Hand-formatting this is the
    easy way to produce a file that parses, matches nothing, and — with ssh_strict=True — refuses
    every connection to a device that is perfectly fine.

    The file is the caller's to delete; it holds a PUBLIC key, so the only cost of a leftover is a
    stale file.
    """
    hostkeys = paramiko.HostKeys()
    entry = host if port == 22 else f"[{host}]:{port}"
    hostkeys.add(entry, key.get_name(), key)

    fd, path = tempfile.mkstemp(prefix="known_hosts_", suffix=".tmp")
    os.close(fd)
    hostkeys.save(path)
    return path


def connect_checked(**kwargs):
    """``ConnectHandler``, with the device's SSH host key verified first.

    Every SSH connection this worker makes goes through here, so that "did we check the host key?"
    has one answer instead of one per call site. ``host`` is required; ``port`` defaults to 22, the
    same default netmiko would apply.

    netmiko is imported inside the function on purpose: the rest of this module is pure enough to
    unit-test without it, and the worker's test suite stubs netmiko at import time.
    """
    from netmiko import ConnectHandler  # noqa: PLC0415 — see the docstring

    host = kwargs.pop("host")
    port = int(kwargs.pop("port", 22) or 22)

    key = verify_host_key(host, port)
    known_hosts = write_known_hosts(host, port, key)
    try:
        return ConnectHandler(
            host=host,
            port=port,
            # ssh_strict turns paramiko's missing-host-key policy from "add it" to "reject it", so
            # the session is pinned to the key the backend just approved. system_host_keys is off
            # because the container's own /root/.ssh/known_hosts is not this system's store.
            ssh_strict=True,
            system_host_keys=False,
            alt_host_keys=True,
            alt_key_file=known_hosts,
            **kwargs,
        )
    finally:
        # The key is public, so a leftover file leaks nothing — but there is one per connection,
        # and this worker runs for weeks.
        try:
            os.unlink(known_hosts)
        except OSError:
            pass
