"""Exchanging a queued job's token for the device login it needs.

The job message used to carry ``username`` and ``password`` outright. That message goes through
Redis, which this project runs with ``--appendonly yes``, so every backup and every config push
appended a firewall administrator's password, in clear, to a file on disk that nothing rewrites.

Now the message carries ``credential_token``: a single-use, 30-minute name for "this job, this
device". This module spends it, once, immediately before the SSH session opens — over the internal
network, under the worker's own ``X-Worker-Secret``.

The backend half is ``backend/services/jobcredential.go`` and
``backend/controller/workercred/workercred.go``.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:9000").rstrip("/")
WORKER_SECRET = os.environ.get("WORKER_SHARED_SECRET", "")

CREDENTIAL_PATH = "/internal/job-credentials"


class CredentialError(RuntimeError):
    """The token could not be exchanged. The job fails with this as its reason."""


def fetch_credentials(token: str, *, timeout: int = 10) -> tuple[str, str]:
    """Exchange ``token`` for ``(username, password)``.

    Raises CredentialError with a message meant for a human reading the job's result row: a worker
    cannot recover from any of these, and retrying spends nothing but the firewall's lockout
    counter.
    """
    if not token:
        raise CredentialError("this job carries no credential token")

    req = urllib.request.Request(
        f"{BACKEND_URL}{CREDENTIAL_PATH}",
        data=json.dumps({"token": token}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Worker-Secret": WORKER_SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        if e.code in (401, 403):
            raise CredentialError(
                "the backend rejected this worker when asking for the device credential — "
                "WORKER_SHARED_SECRET does not match the backend's"
            ) from e
        if e.code == 404:
            raise CredentialError(
                "this job's credential token is no longer valid (expired, already used, or the "
                "job was removed) — run the job again"
            ) from e
        raise CredentialError(f"could not obtain the device credential (HTTP {e.code}): {detail}") from e
    except Exception as e:  # noqa: BLE001
        raise CredentialError(f"could not reach the backend for the device credential: {e}") from e

    username = body.get("username") or ""
    password = body.get("password") or ""
    if not username:
        raise CredentialError("the backend returned no username for this device")
    return username, password


def credentials_for(msg: dict) -> tuple[str, str]:
    """Credentials for a job message, whichever shape it has.

    A message already sitting in the queue when the backend was upgraded still carries the old
    inline fields. Honouring them keeps a restart from failing every queued job — and they
    disappear on their own as the queue drains, because nothing enqueues them any more.
    """
    token = msg.get("credential_token")
    if token:
        return fetch_credentials(token)
    if msg.get("username"):
        return msg["username"], msg.get("password") or ""
    raise CredentialError("this job carries no credential token")
