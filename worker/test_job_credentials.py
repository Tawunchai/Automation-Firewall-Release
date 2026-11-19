"""The job credential exchange.

These tests exist because of what they replaced: the Redis job message used to carry the firewall's
decrypted administrator password, and Redis runs here with --appendonly yes, so every backup and
every config push wrote that password to disk permanently. The message now carries a single-use
token; this is the code that spends it, and the failure paths matter as much as the happy one —
a worker that silently falls back to "no password" would attempt a login and burn one of the three
tries FortiOS allows before it locks the account.
"""

from __future__ import annotations

import io
import json
import unittest
import urllib.error
from unittest import mock

from test_worker import _install_stubs  # installs the redis/netmiko stubs these imports need

_install_stubs()

import job_credentials  # noqa: E402


def _response(payload: dict):
    """A urlopen context manager returning this JSON."""
    body = json.dumps(payload).encode()
    cm = mock.MagicMock()
    cm.__enter__.return_value = io.BytesIO(body)
    cm.__exit__.return_value = False
    return cm


def _http_error(code: int, body: str = ""):
    return urllib.error.HTTPError(
        url="http://backend:9000/internal/job-credentials", code=code,
        msg="err", hdrs=None, fp=io.BytesIO(body.encode()),
    )


class FetchCredentials(unittest.TestCase):
    def test_exchanges_a_token_for_the_login(self):
        with mock.patch.object(job_credentials.urllib.request, "urlopen",
                               return_value=_response({"username": "svc", "password": "s3cret"})) as up:
            user, pw = job_credentials.fetch_credentials("tok123")

        self.assertEqual((user, pw), ("svc", "s3cret"))
        req = up.call_args[0][0]
        self.assertEqual(json.loads(req.data.decode()), {"token": "tok123"},
                         "the token is the whole request — nothing else identifies the job")
        # urllib normalises header names ("X-worker-secret"), so compare case-insensitively.
        sent = {k.lower() for k in req.headers}
        self.assertIn("x-worker-secret", sent,
                      "the exchange must still authenticate as the worker")

    def test_an_empty_token_never_reaches_the_network(self):
        with mock.patch.object(job_credentials.urllib.request, "urlopen") as up:
            with self.assertRaises(job_credentials.CredentialError):
                job_credentials.fetch_credentials("")
        up.assert_not_called()

    def test_a_spent_or_expired_token_says_so_in_words_a_person_can_act_on(self):
        with mock.patch.object(job_credentials.urllib.request, "urlopen", side_effect=_http_error(404)):
            with self.assertRaises(job_credentials.CredentialError) as ctx:
                job_credentials.fetch_credentials("tok")
        self.assertIn("run the job again", str(ctx.exception))

    def test_a_secret_mismatch_names_the_cause(self):
        with mock.patch.object(job_credentials.urllib.request, "urlopen", side_effect=_http_error(401)):
            with self.assertRaises(job_credentials.CredentialError) as ctx:
                job_credentials.fetch_credentials("tok")
        self.assertIn("WORKER_SHARED_SECRET", str(ctx.exception))

    def test_a_backend_that_answers_without_a_username_is_a_failure_not_an_empty_login(self):
        with mock.patch.object(job_credentials.urllib.request, "urlopen",
                               return_value=_response({"password": "x"})):
            with self.assertRaises(job_credentials.CredentialError):
                job_credentials.fetch_credentials("tok")


class CredentialsFor(unittest.TestCase):
    def test_prefers_the_token(self):
        msg = {"credential_token": "tok", "username": "stale", "password": "stale"}
        with mock.patch.object(job_credentials, "fetch_credentials",
                               return_value=("fresh", "fresh-pw")) as fetch:
            self.assertEqual(job_credentials.credentials_for(msg), ("fresh", "fresh-pw"))
        fetch.assert_called_once_with("tok")

    def test_falls_back_to_an_inline_login_for_a_message_queued_before_the_upgrade(self):
        """A job already in the queue when the backend restarts must still run."""
        msg = {"username": "old", "password": "old-pw"}
        with mock.patch.object(job_credentials.urllib.request, "urlopen") as up:
            self.assertEqual(job_credentials.credentials_for(msg), ("old", "old-pw"))
        up.assert_not_called()

    def test_a_message_with_neither_fails_rather_than_connecting_with_nothing(self):
        with self.assertRaises(job_credentials.CredentialError):
            job_credentials.credentials_for({"host": "10.0.0.1"})


if __name__ == "__main__":
    unittest.main()
