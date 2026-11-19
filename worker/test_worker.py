#!/usr/bin/env python3
"""
Tests สำหรับ worker.py — shared-secret validation + heartbeat + retry loop

รัน:
    python -m unittest test_worker -v

ทำไมต้อง stub `redis` / `netmiko` ก่อน import:
    worker.py (และ backup_fortigate / config_push ที่มันดึงเข้ามา) import
    netmiko + redis ตั้งแต่ระดับ module. ทั้งสองตัวมีเฉพาะใน worker container — ถ้าไม่ stub
    เทสชุดนี้จะรันได้ที่เดียวคือใน docker ซึ่งทำให้แทบไม่มีใครรันมันเลย. สิ่งที่เทสนี้ตรวจ
    (validate secret, heartbeat, retry budget) ไม่ได้แตะ SSH หรือ Redis จริงสักบรรทัด
    จึงไม่ต้องพึ่งของจริง.
"""
from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from unittest import mock

# worker.py logs in Thai and prints "✓"/"❗". In Docker that is fine — the container is UTF-8 — but
# a Windows console running on a legacy codepage (cp874/cp1252) raises UnicodeEncodeError inside
# print(), which surfaces as tests "failing" in Git Bash while the same tests pass in PowerShell.
# That is a property of the terminal, not of the code, so it is corrected here rather than by
# taking the Thai out of the worker's log lines.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # already UTF-8, or not reconfigurable
        pass


# ── Stub the two external dependencies before importing worker ───────────────

from stub_modules import install_paramiko_stub

def _install_stubs() -> None:
    if "redis" not in sys.modules:
        redis_stub = types.ModuleType("redis")

        class _Redis:
            @staticmethod
            def from_url(*_a, **_kw):
                raise RuntimeError("test must not open a real Redis connection")

        class _Exceptions(types.ModuleType):
            pass

        exc = types.ModuleType("redis.exceptions")
        exc.TimeoutError = type("TimeoutError", (Exception,), {})
        exc.ConnectionError = type("ConnectionError", (Exception,), {})

        redis_stub.Redis = _Redis
        redis_stub.exceptions = exc
        sys.modules["redis"] = redis_stub
        sys.modules["redis.exceptions"] = exc

    if "netmiko" not in sys.modules:
        netmiko_stub = types.ModuleType("netmiko")
        netmiko_stub.ConnectHandler = lambda *a, **kw: (_ for _ in ()).throw(
            RuntimeError("test must not open a real SSH session")
        )
        nm_exc = types.ModuleType("netmiko.exceptions")
        nm_exc.NetmikoAuthenticationException = type("NetmikoAuthenticationException", (Exception,), {})
        nm_exc.NetmikoTimeoutException = type("NetmikoTimeoutException", (Exception,), {})
        netmiko_stub.exceptions = nm_exc
        sys.modules["netmiko"] = netmiko_stub
        sys.modules["netmiko.exceptions"] = nm_exc

    # host_keys.py imports paramiko to read a device's SSH host key before any password is sent.
    # The stub lives in stub_modules.py because test_backup_and_push.py needs it too and cannot
    # import this file — see the note there.
    install_paramiko_stub()


_install_stubs()

import worker  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Shared-secret validation
#
# The backend refuses to boot on a bad WORKER_SHARED_SECRET. The worker used to fall back to the
# leaked docker-compose default and start happily — then every /internal/* callback came back 401
# and the job hung in RUNNING until the scheduler timed it out five minutes later. These tests pin
# the worker to the SAME rules as services.ValidateWorkerSecret on the Go side.
# ─────────────────────────────────────────────────────────────────────────────

class TestRequireWorkerSecret(unittest.TestCase):
    def test_unset_is_rejected(self):
        for value in ("", "   ", "\n"):
            with self.subTest(value=repr(value)):
                err = worker.require_worker_secret(value)
                self.assertIsNotNone(err, "an unset secret must be refused")
                self.assertIn("not set", err)

    def test_leaked_placeholders_are_rejected(self):
        # The exact value docker-compose.yml used to default to — it is public.
        for value in ("dev-worker-secret-change-me", "change-me", "changeme"):
            with self.subTest(value=value):
                err = worker.require_worker_secret(value)
                self.assertIsNotNone(err, f"{value!r} is published in the repo and must be refused")
                self.assertIn("placeholder", err)

    def test_leaked_placeholder_check_is_case_insensitive(self):
        self.assertIsNotNone(worker.require_worker_secret("Dev-Worker-Secret-Change-Me"))

    def test_short_secret_is_rejected(self):
        err = worker.require_worker_secret("a" * (worker.MIN_WORKER_SECRET_LEN - 1))
        self.assertIsNotNone(err)
        self.assertIn(str(worker.MIN_WORKER_SECRET_LEN), err)

    def test_real_secret_is_accepted(self):
        # 64 hex chars, as `openssl rand -hex 32` produces.
        self.assertIsNone(worker.require_worker_secret("a3f1" * 16))

    def test_boundary_length_is_accepted(self):
        self.assertIsNone(worker.require_worker_secret("x" * worker.MIN_WORKER_SECRET_LEN))

    def test_matches_the_go_side_rules(self):
        """The two implementations must agree, or one side boots and the other does not."""
        self.assertEqual(
            worker.LEAKED_WORKER_SECRETS,
            {"dev-worker-secret-change-me", "change-me", "changeme"},
            "keep in sync with leakedWorkerSecrets in backend/services/queue.go",
        )
        self.assertEqual(
            worker.MIN_WORKER_SECRET_LEN, 16,
            "keep in sync with minWorkerSecretLen in backend/services/queue.go",
        )

    def test_module_default_is_no_longer_the_leaked_value(self):
        """Regression guard: the fallback that caused the silent 401s must stay gone.

        An unset env var is the normal state when running tests, so this does not assert the
        secret is valid — only that the module never invents one. Re-adding the old
        `os.environ.get(..., "dev-worker-secret-change-me")` default would fail here.
        """
        self.assertNotIn(worker.WORKER_SECRET.strip().lower(), worker.LEAKED_WORKER_SECRETS)


# ─────────────────────────────────────────────────────────────────────────────
# Heartbeat
#
# The heartbeat used to be driven by the main loop's brpop tick, so it only beat while the worker
# was IDLE. Anything that occupied the loop for longer than HEARTBEAT_TTL let the key expire and
# the Devices page reported "worker offline" precisely while it was busiest — a backup retry
# sleeping 30/60/120s being the worst case at 210s of silence against a 60s TTL.
# ─────────────────────────────────────────────────────────────────────────────

class _FakeRedis:
    """Records beats, so a test can count them without a Redis server.

    Only `set` is defined — no `setex`. redis-py 8 deprecates setex and warned on every beat, so
    the heartbeat uses set(..., ex=). If it ever reverts, these tests fail with AttributeError
    rather than silently passing.
    """

    def __init__(self, fail_times: int = 0):
        self.beats: list[tuple[str, int]] = []
        self.fail_times = fail_times
        self._lock = threading.Lock()

    def set(self, key, _value, ex=None, **_kw):
        with self._lock:
            if self.fail_times > 0:
                self.fail_times -= 1
                raise ConnectionError("redis is down")
            self.beats.append((key, ex))

    def beat_count(self) -> int:
        with self._lock:
            return len(self.beats)


class TestHeartbeat(unittest.TestCase):
    def test_ttl_leaves_room_for_missed_beats(self):
        """A single missed beat must not be enough to look offline."""
        self.assertLess(
            worker.HEARTBEAT_EVERY, worker.HEARTBEAT_TTL / 2,
            "the beat interval must be under half the TTL, or one hiccup reads as a dead worker",
        )

    def test_beats_immediately_on_start(self):
        """The first beat must not wait a full interval — a restarted worker looks dead until it."""
        r = _FakeRedis()
        with mock.patch.object(worker, "HEARTBEAT_EVERY", 10):
            stop = worker.start_heartbeat(r)
            self.addCleanup(stop.set)
            deadline = time.time() + 2
            while r.beat_count() == 0 and time.time() < deadline:
                time.sleep(0.005)
        self.assertGreaterEqual(r.beat_count(), 1, "no beat within 2s of starting")
        self.assertEqual(r.beats[0], (worker.HEARTBEAT_KEY, worker.HEARTBEAT_TTL))

    @staticmethod
    def _block_until(predicate, timeout=5.0):
        """Block the MAIN thread until predicate() holds, or timeout.

        The sleeping is the point: it reproduces do_backup's `time.sleep(RETRY_DELAYS[n])`, so the
        heartbeat is being asked to keep running while the main thread is stuck.

        A deadline rather than a fixed sleep because "at least N beats within exactly 250ms" is a
        race against the scheduler: on a loaded machine the daemon thread can be starved long
        enough to fail an assertion about code that is working perfectly. Waiting for the
        CONDITION, with a generous ceiling, tests the same property without the race.
        """
        deadline = time.time() + timeout
        while not predicate() and time.time() < deadline:
            time.sleep(0.02)
        return predicate()

    def test_keeps_beating_while_the_main_thread_is_blocked(self):
        """THE bug: a backup retry sleeping on the main thread must not stop the heartbeat."""
        r = _FakeRedis()
        with mock.patch.object(worker, "HEARTBEAT_EVERY", 0.02):
            stop = worker.start_heartbeat(r)
            self.addCleanup(stop.set)
            got = self._block_until(lambda: r.beat_count() > 3)
            beats = r.beat_count()
        self.assertTrue(
            got,
            f"only {beats} beats while the main thread was blocked — the heartbeat must run "
            f"on its own thread, not on the brpop tick",
        )

    def test_survives_a_redis_outage(self):
        """A blip must not kill the thread — the worker would then look permanently offline."""
        r = _FakeRedis(fail_times=3)
        with mock.patch.object(worker, "HEARTBEAT_EVERY", 0.02):
            stop = worker.start_heartbeat(r)
            self.addCleanup(stop.set)
            recovered = self._block_until(lambda: r.beat_count() > 0)
        self.assertTrue(recovered, "the thread died on the first Redis error instead of retrying")

    def test_stop_event_ends_the_thread(self):
        r = _FakeRedis()
        with mock.patch.object(worker, "HEARTBEAT_EVERY", 0.01):
            stop = worker.start_heartbeat(r)
            self._block_until(lambda: r.beat_count() > 0)
            stop.set()
            # Generous settle time: a beat already in flight when stop was set is allowed to land.
            time.sleep(0.3)
            settled = r.beat_count()
            time.sleep(0.3)
        self.assertEqual(r.beat_count(), settled, "the heartbeat kept beating after stop was set")

    def test_thread_is_daemon(self):
        """A non-daemon heartbeat would keep the process alive after the main loop exits."""
        r = _FakeRedis()
        # Compare thread OBJECTS, not names. Every heartbeat thread is called "heartbeat", and the
        # ones started by the tests above do not die the instant their stop event is set — they are
        # asleep until the next tick. So a name-based diff would find "heartbeat" already present,
        # filter out the thread this test just started, and fail with "heartbeat thread not found"
        # depending on how the previous test happened to be scheduled. That is exactly what it did:
        # it passed eight times in a row in isolation and failed once in a full run.
        before = set(threading.enumerate())
        stop = worker.start_heartbeat(r)
        self.addCleanup(stop.set)

        # start() has already registered the thread, but wait rather than assume: a bounded wait
        # cannot reintroduce a race, and a bare sleep only moves one.
        deadline = time.monotonic() + 2.0
        new = []
        while time.monotonic() < deadline:
            new = [t for t in threading.enumerate() if t not in before and t.name == "heartbeat"]
            if new:
                break
            time.sleep(0.01)

        self.assertTrue(new, "heartbeat thread not found")
        self.assertTrue(new[0].daemon, "the heartbeat thread must be a daemon")


# ─────────────────────────────────────────────────────────────────────────────
# Backup retry budget
#
# The retries were recursive; they are now a loop. The observable contract is unchanged and these
# tests state it: N delays means N+1 attempts, the delays are used in order, and a success stops
# the loop immediately.
# ─────────────────────────────────────────────────────────────────────────────

class TestBackupRetryLoop(unittest.TestCase):
    def _run_backup(self, results, msg_overrides=None):
        """Drive do_backup with a scripted sequence of _smart_backup outcomes.

        Returns (attempts, sleeps, callbacks).
        """
        attempts = []
        sleeps = []
        callbacks = []

        seq = list(results)

        def fake_smart(vendor, host, port, user, pw):
            attempts.append(vendor)
            return seq.pop(0) if seq else (None, "exhausted")

        msg = {
            "job_id": 42, "name": "lab-fgt", "platform": "fortinet",
            "host": "10.0.99.201", "port": 22, "username": "admin", "password": "pw",
        }
        msg.update(msg_overrides or {})

        with mock.patch.object(worker, "_smart_backup", side_effect=fake_smart), \
             mock.patch.object(worker, "time") as fake_time, \
             mock.patch.object(worker, "_callback", side_effect=lambda p, b: callbacks.append(p)), \
             mock.patch.object(worker, "save", return_value={
                 "git_commit": "abc123", "sha256": "d" * 64, "path": "/x.conf",
                 "bytes": 10, "lines": 2,
             }):
            fake_time.sleep.side_effect = sleeps.append
            worker.do_backup(msg)

        return attempts, sleeps, callbacks

    def test_success_first_time_does_not_retry(self):
        attempts, sleeps, callbacks = self._run_backup([("fortinet", "config here")])
        self.assertEqual(len(attempts), 1)
        self.assertEqual(sleeps, [], "a successful backup must not sleep")
        self.assertIn("/internal/jobs/42/start", callbacks)
        self.assertIn("/internal/jobs/42/result", callbacks)

    def test_retries_are_bounded_by_retry_delays(self):
        """N delays = N+1 attempts, then give up. No more, no fewer."""
        attempts, sleeps, _ = self._run_backup([(None, "timeout")] * 10)
        self.assertEqual(
            len(attempts), len(worker.RETRY_DELAYS) + 1,
            "the retry budget must be exactly RETRY_DELAYS + the first attempt",
        )
        self.assertEqual(sleeps, list(worker.RETRY_DELAYS), "delays must be used in order")

    def test_recovers_on_a_later_attempt(self):
        attempts, sleeps, callbacks = self._run_backup([
            (None, "timeout"), (None, "timeout"), ("fortinet", "config here"),
        ])
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleeps, list(worker.RETRY_DELAYS[:2]),
                         "it must stop sleeping the moment a backup succeeds")
        self.assertIn("/internal/jobs/42/result", callbacks)

    def test_unknown_platform_fails_without_retrying(self):
        """An unsupported vendor is not a transient fault — retrying it wastes 210s."""
        attempts, sleeps, callbacks = self._run_backup(
            [], msg_overrides={"platform": "not-a-vendor"},
        )
        self.assertEqual(attempts, [], "an unknown platform must never reach the SSH path")
        self.assertEqual(sleeps, [])
        self.assertIn("/internal/jobs/42/start", callbacks)
        self.assertIn("/internal/jobs/42/result", callbacks)

    def test_start_callback_is_sent_exactly_once(self):
        """Retries must not re-announce the job as starting — it flapped the UI status."""
        _, _, callbacks = self._run_backup([(None, "timeout")] * 10)
        self.assertEqual(
            callbacks.count("/internal/jobs/42/start"), 1,
            "the RUNNING callback must be sent once, not once per attempt",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Dead code that was removed
# ─────────────────────────────────────────────────────────────────────────────

class TestDiffSummaryIsTheBackendsJob(unittest.TestCase):
    def test_worker_no_longer_claims_to_compute_a_diff(self):
        """`_diff_summary` read a `_prev_content` key nothing ever set, so it always returned "".

        The backend computes the diff from the previous backup it already holds
        (controller/automationjob.WorkerResult). Re-adding it here would mean shipping the whole
        previous config over the queue for a value the backend can derive for free.
        """
        self.assertFalse(
            hasattr(worker, "_diff_summary"),
            "_diff_summary is dead code — the backend owns the diff",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)


class RedactedRedisURLTests(unittest.TestCase):
    """The worker prints its Redis URL on every boot, and that URL now has a password in it."""

    def test_password_is_replaced(self):
        self.assertEqual(
            worker._redacted_redis_url("redis://:hunter2@redis:6379/0"),
            "redis://:***@redis:6379/0",
        )

    def test_username_and_password(self):
        self.assertEqual(
            worker._redacted_redis_url("redis://app:hunter2@redis:6379/0"),
            "redis://app:***@redis:6379/0",
        )

    def test_a_password_containing_an_at_sign_still_goes(self):
        # rpartition on "@" — the LAST one separates credentials from the host.
        self.assertEqual(
            worker._redacted_redis_url("redis://:pw@with@redis:6379/0"),
            "redis://:***@redis:6379/0",
        )

    def test_url_without_a_password_is_untouched(self):
        for url in (
            "redis://redis:6379/0",
            "redis://localhost:6379/0",
            "rediss://redis:6380/0",
        ):
            self.assertEqual(worker._redacted_redis_url(url), url)

    def test_nonsense_prints_something_rather_than_raising(self):
        # Boot logging must not be the thing that crashes the worker.
        self.assertEqual(worker._redacted_redis_url("not a url@host"), "not a url@host")
        self.assertEqual(worker._redacted_redis_url(""), "")
