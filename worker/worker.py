#!/usr/bin/env python3
"""
Automation Worker — ฟังคิวงานจาก Redis แล้วทำ backup อุปกรณ์ → รายงานผลกลับ Go backend

flow ต่อ 1 งาน:
    BRPOP automation:jobs
      → POST {BACKEND_URL}/internal/jobs/{id}/start   (mark RUNNING)
      → probe + detect platform → SSH backup → save ไฟล์ + git commit
      → POST {BACKEND_URL}/internal/jobs/{id}/result  (SUCCESS/FAILED + metadata)

Smart platform detection (2 phase):
    Phase 1 (probe) : เชื่อมต่อด้วย probe driver → รัน detection command (show version ฯลฯ)
                      → parse output → ระบุ netmiko device_type จริง
    Phase 2 (backup): เชื่อมต่อด้วย platform จริง → enter enable mode ถ้าต้องการ → backup

Fallback cascade:
    ถ้า probe connect ล้มเหลวหรือ parse ไม่ออก → ลอง cascade VENDOR_PLATFORMS[vendor] ตามลำดับ
    ป้องกัน false-negative กรณีอุปกรณ์ตอบ show version ไม่ออก

env:
    REDIS_URL              default redis://localhost:6379/0
    BACKEND_URL            default http://localhost:9000
    WORKER_SHARED_SECRET   ต้องตรงกับฝั่ง Go (header X-Worker-Secret)
"""
from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import redis
from netmiko import ConnectHandler
from netmiko.exceptions import (
    NetmikoAuthenticationException,
    NetmikoTimeoutException,
)

from backup_fortigate import save
from config_push import handle_config
from job_credentials import CredentialError, credentials_for
from host_keys import HostKeyError, connect_checked
from device_profiles import (
    BACKUP_CMD,
    DEFAULT_PLATFORM,
    NEEDS_ENABLE,
    PAGING_DISABLE_CMD,
    VENDOR_PLATFORMS,
    VENDOR_PROBE,
    identify_platform_from_output,
    is_config_error,
)

REDIS_URL             = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
BACKEND_URL           = os.environ.get("BACKEND_URL", "http://localhost:9000").rstrip("/")
WORKER_SECRET         = os.environ.get("WORKER_SHARED_SECRET", "")
QUEUE_KEY             = "automation:jobs"
CONFIG_QUEUE_KEY      = "automation:config"
HEARTBEAT_KEY         = "worker:heartbeat"
HEARTBEAT_TTL         = 60   # seconds — health endpoint treats > TTL as offline
HEARTBEAT_EVERY       = 20   # seconds between beats — TTL/3, so two may be missed before offline
RETRY_DELAYS          = (30, 60, 120)  # seconds between backup retries

# ── Shared-secret validation ─────────────────────────────────────────────────
# Mirrors services.ValidateWorkerSecret on the Go side, and for the same reason: the /internal/*
# callbacks write job results and config-deploy outcomes straight into the database, so the secret
# guarding them must never be a value published in the repo.
#
# Why the worker checks too, when the backend already does: the failure was ASYMMETRIC. The
# backend refuses to boot on a bad secret, but the worker used to fall back to the leaked
# docker-compose default and start happily — then every callback came back 401, which was only
# ever printed to stderr. The visible symptom was jobs sitting in RUNNING until the scheduler
# timed them out five minutes later, with nothing pointing at the real cause. Failing at startup
# turns fifteen minutes of confusion into one line of log.
LEAKED_WORKER_SECRETS = {"dev-worker-secret-change-me", "change-me", "changeme"}
MIN_WORKER_SECRET_LEN = 16


def require_worker_secret(secret: str) -> str | None:
    """คืน error message ถ้า secret ใช้ไม่ได้, คืน None ถ้าผ่าน (แยกออกมาเพื่อเทสได้)"""
    stripped = secret.strip()
    if not stripped:
        return ("WORKER_SHARED_SECRET is not set — generate one with `openssl rand -hex 32` "
                "and set it for BOTH the backend and the worker")
    if stripped.lower() in LEAKED_WORKER_SECRETS:
        return ("WORKER_SHARED_SECRET is set to a well-known placeholder value; anyone could post "
                "forged job results to /internal/*. Generate a real secret with `openssl rand -hex 32`")
    if len(secret) < MIN_WORKER_SECRET_LEN:
        return (f"WORKER_SHARED_SECRET must be at least {MIN_WORKER_SECRET_LEN} characters "
                f"(got {len(secret)})")
    return None


def _log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def _callback(path: str, payload: dict) -> None:
    url = f"{BACKEND_URL}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Worker-Secret": WORKER_SECRET,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            # Name the cause. A rejected callback means the job silently hangs until the
            # scheduler times it out, and the reason is almost always a secret mismatch.
            print(f"[!] callback {path} HTTP {e.code}: backend rejected this worker — "
                  f"WORKER_SHARED_SECRET does not match the backend's. The job will hang until "
                  f"the scheduler times it out.", file=sys.stderr)
        else:
            print(f"[!] callback {path} HTTP {e.code}: {e.read().decode(errors='ignore')}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[!] callback {path} error: {e}", file=sys.stderr)


# ── Heartbeat ────────────────────────────────────────────────────────────────
# The heartbeat runs on its own daemon thread rather than on the main loop's brpop tick.
#
# It used to beat every 6 ticks of a 5s brpop, i.e. only while the worker was IDLE and waiting for
# work. Anything that occupied the main loop for longer than HEARTBEAT_TTL let the key expire, and
# the Devices page then reported the worker OFFLINE precisely while it was busiest:
#   · a backup retry sleeping 30/60/120s (RETRY_DELAYS)  — up to 210s of silence
#   · one slow `show running-config` (_safe_send read_timeout=120)
#   · a config push across several devices
# A separate thread beats on wall-clock time, so "is the worker alive" stops depending on what it
# happens to be doing.

def _heartbeat_loop(r: redis.Redis, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            # set(..., ex=) rather than setex(): redis-py 8 deprecates setex, and it logged a
            # DeprecationWarning on every beat.
            r.set(HEARTBEAT_KEY, datetime.now(timezone.utc).isoformat(), ex=HEARTBEAT_TTL)
        except Exception:  # noqa: BLE001
            pass  # a redis blip must not kill the thread — the next beat retries
        stop.wait(HEARTBEAT_EVERY)


def start_heartbeat(r: redis.Redis) -> threading.Event:
    """เริ่ม heartbeat thread — คืน Event สำหรับสั่งหยุด"""
    stop = threading.Event()
    threading.Thread(target=_heartbeat_loop, args=(r, stop), daemon=True, name="heartbeat").start()
    return stop


# How long one BRPOP waits before returning empty and letting the loop go round again.
#
# This is the shutdown latency of an IDLE worker, not a queue tuning knob: nothing arrives late
# because of it — a job pushed to Redis wakes the BRPOP immediately.
#
# It was 5s, and that lost a race it should never have been in. Measured on this host, `docker stop`
# SIGKILLs the container about 3.4 seconds after the SIGTERM (four runs: 3381, 3394, 3381, 3379 ms)
# — shorter than the documented 10s default, and shorter than the 5s window the loop needed to
# notice the flag. The result was exit 137 and no cleanup on roughly every stop that caught the
# worker mid-wait. One second leaves the decision to us rather than to whatever the platform's
# grace period turns out to be, and costs sixty idle round-trips a minute to a Redis on the same
# bridge network.
#
# A worker that is BUSY when the signal arrives is a different case and is covered by
# stop_grace_period in docker-compose.yml: it finishes the job and reports the result first.
BRPOP_TIMEOUT = 1


# ── Graceful shutdown ────────────────────────────────────────────────────────
# `docker compose up -d --build` sends SIGTERM and waits ten seconds before SIGKILL. Without a
# handler that signal killed the process wherever it happened to be — including halfway through a
# backup, with the job already marked RUNNING and no result ever posted. The scheduler then marked
# it stale minutes later and the Jobs page showed a FAILED backup that had nothing wrong with it
# except that somebody redeployed.
#
# So the flag is checked in ONE place: between jobs, at the top of the loop. A job already in flight
# is allowed to finish and report its result — that is the whole point, and it is why nothing here
# tries to interrupt netmiko mid-session. A backup that cannot finish inside docker's grace period
# is killed exactly as before; what changes is that the common case, a redeploy while the worker is
# idle or nearly done, stops manufacturing failures.
#
# A SECOND signal exits immediately. Someone pressing Ctrl-C twice means it, and the alternative is
# a worker that appears to ignore them while a slow SSH read finishes.
_shutdown = threading.Event()


def _install_signal_handlers() -> None:
    def handle(signum: int, _frame: object) -> None:
        name = signal.Signals(signum).name
        if _shutdown.is_set():
            _log(f"[worker] {name} again — exiting now")
            raise SystemExit(1)
        _log(f"[worker] {name} — stopping after the current job (send it again to exit now)")
        _shutdown.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, handle)


def _fail(job_id: int, reason: str) -> None:
    _log(f"[!] job {job_id}: FAILED — {reason}")
    _callback(f"/internal/jobs/{job_id}/result", {"status": "FAILED", "result": reason})


# ─────────────────────────────────────────────────────────────────────────────
# Connection + safe send helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_send(conn, cmd: str, timeout: int = 120) -> str:
    """ส่งคำสั่ง → คืน output string (ไม่ throw)

    Strategy (ป้องกัน ReadTimeout บน Dell N-series DNOS6 / firmware quirks):
      1. send_command()        รอ prompt pattern — เร็ว แต่ fail ถ้า device echo ผิดปกติ
      2. send_command_timing() timing-based fallback — ช้ากว่าแต่รองรับทุก device
    """
    try:
        return conn.send_command(
            cmd, read_timeout=timeout,
            strip_prompt=True, strip_command=True,
        )
    except Exception:  # noqa: BLE001
        pass
    try:
        return conn.send_command_timing(
            cmd,
            delay_factor=3,
            max_loops=int(timeout / 0.3),
            strip_prompt=True,
            strip_command=True,
        )
    except Exception as e:  # noqa: BLE001
        return f"[error] {type(e).__name__}: {e}"


def _connect(platform: str, host: str, port: int, username: str, password: str):
    """เชื่อมต่อ + enable + disable paging

    ทำไม secret=password:
      Cisco/Dell N-series ใช้ enable password เดียวกับ login password
      ถ้าผิด → enable() catch exception แล้วดำเนินการต่อ

    ทำไมไม่ใส่ dell_force10 ใน NEEDS_ENABLE:
      dell_force10 มักอยู่ใน privileged mode แล้วหลัง login
      ถ้าเรียก enable() กับ device ที่ใช้ Cisco IOS จริง (ผิด driver) → hang รอ prompt

    ทำไมต้อง disable paging ซ้ำหลัง enable:
      Dell N-series DNOS6 บางรุ่น terminal length 0 reset หลัง enable
      → ส่งซ้ำเพื่อกัน --More-- hang ใน send_command(show running-config)
    """
    conn = connect_checked(
        device_type=platform,
        host=host, port=port,
        username=username, password=password,
        secret=password,
        fast_cli=False,
        conn_timeout=15,
    )
    if platform in NEEDS_ENABLE:
        try:
            if not conn.check_enable_mode():
                conn.enable(cmd_verify=False)
        except Exception:  # noqa: BLE001
            pass

    paging_cmd = PAGING_DISABLE_CMD.get(platform)
    if paging_cmd:
        try:
            conn.send_command_timing(paging_cmd, delay_factor=1, max_loops=30)
        except Exception:  # noqa: BLE001
            pass

    return conn


# ─────────────────────────────────────────────────────────────────────────────
# Smart probe: Phase 1 detect + Phase 2 backup
# ─────────────────────────────────────────────────────────────────────────────

def _probe_platform(vendor: str, host: str, port: int, username: str, password: str) -> str | None:
    """Phase 1: เชื่อมต่อด้วย probe driver → รัน detection command → parse platform

    probe ไม่เรียก enable() (show version ทำงานได้ใน user mode เสมอ)
    คืน platform string หรือ None ถ้า detect ไม่ได้
    """
    probe_entry = VENDOR_PROBE.get(vendor)
    if not probe_entry:
        return None

    probe_driver, probe_cmd = probe_entry
    _log(f"    [probe] connecting with driver={probe_driver}, running '{probe_cmd}' ...")
    try:
        conn = connect_checked(
            device_type=probe_driver,
            host=host,
            port=port,
            username=username,
            password=password,
            secret=password,
            fast_cli=False,
            conn_timeout=15,
        )
        try:
            probe_out = _safe_send(conn, probe_cmd, timeout=30)
        finally:
            try:
                conn.disconnect()
            except Exception:  # noqa: BLE001
                pass

        platform = identify_platform_from_output(probe_out)
        if platform:
            _log(f"    [probe] ✓ identified: platform={platform}")
        else:
            _log("    [probe] ✗ could not parse the output → fallback cascade")
        return platform

    except (NetmikoAuthenticationException, NetmikoTimeoutException):
        raise
    except HostKeyError:
        # Re-raised, not swallowed into "fallback cascade": the host key belongs to the HOST, so
        # every other driver would read the same key and be refused the same way. Falling through
        # would turn one clear refusal into five obscure ones.
        raise
    except Exception as e:  # noqa: BLE001
        _log(f"    [probe] ✗ probe failed: {type(e).__name__}: {e} → fallback cascade")
        return None


def _direct_backup(
    platform: str, host: str, port: int, username: str, password: str,
) -> tuple[str, str] | tuple[None, str]:
    """backup ด้วย platform ที่รู้แน่แล้ว (จาก probe หรือ direct spec)
    คืน (platform, config_text) หรือ (None, error_message)"""
    try:
        conn = _connect(platform, host, port, username, password)
    except NetmikoAuthenticationException:
        return None, "login refused (check the username/password)"
    except NetmikoTimeoutException:
        return None, f"cannot reach {host}:{port} (network, or allowaccess ssh)"
    except HostKeyError as e:
        return None, str(e)
    except Exception as e:  # noqa: BLE001
        return None, f"connection failed: {type(e).__name__}: {e}"

    try:
        config_text = _safe_send(conn, BACKUP_CMD[platform], timeout=120)
    except Exception as e:  # noqa: BLE001
        return None, f"reading the config failed: {e}"
    finally:
        try:
            conn.disconnect()
        except Exception:  # noqa: BLE001
            pass

    err = is_config_error(config_text, platform)
    if err:
        return None, f"ดึง config ล้มเหลว: {err}"

    return platform, config_text


def _cascade_backup(
    vendor: str, host: str, port: int, username: str, password: str,
) -> tuple[str, str] | tuple[None, str]:
    """Fallback cascade: ลองแต่ละ platform ใน VENDOR_PLATFORMS[vendor] ตามลำดับ
    ใช้เมื่อ probe detect ไม่ได้ เพื่อกัน false-negative

    คืน (detected_platform, config_text) เมื่อสำเร็จ
    คืน (None, error_message)            เมื่อล้มเหลวทุก platform
    """
    platforms = VENDOR_PLATFORMS.get(vendor)
    if not platforms:
        known = ", ".join(VENDOR_PLATFORMS)
        return None, f"unknown vendor='{vendor}' — supported: {known}"

    cli_errors: list[str] = []
    for platform in platforms:
        if platform not in BACKUP_CMD:
            continue
        _log(f"    [cascade] trying platform={platform} ...")
        try:
            conn = _connect(platform, host, port, username, password)
        except NetmikoAuthenticationException:
            return None, "login refused (check the username/password)"
        except NetmikoTimeoutException:
            return None, f"cannot reach {host}:{port} (timeout) — check the network and SSH allowaccess"
        except HostKeyError as e:
            # Not appended to cli_errors and retried with the next driver: the key is the same
            # whichever driver reads it.
            return None, str(e)
        except Exception as e:  # noqa: BLE001
            cli_errors.append(f"[{platform}] connect: {type(e).__name__}: {e}")
            continue

        try:
            config_text = _safe_send(conn, BACKUP_CMD[platform], timeout=120)
        except Exception as e:  # noqa: BLE001
            cli_errors.append(f"[{platform}] send_command: {e}")
            continue
        finally:
            try:
                conn.disconnect()
            except Exception:  # noqa: BLE001
                pass

        err = is_config_error(config_text, platform)
        if err:
            cli_errors.append(f"[{platform}] {err}")
            continue

        _log(f"    [cascade] ✓ succeeded with platform={platform}")
        return platform, config_text

    details = " | ".join(cli_errors) if cli_errors else "(no error detail)"
    return None, f"every platform of vendor='{vendor}' failed: {details}"


def _smart_backup(
    vendor: str, host: str, port: int, username: str, password: str,
) -> tuple[str, str] | tuple[None, str]:
    """Smart backup: probe → detect → backup ตรงจุด, fallback cascade ถ้าจำเป็น"""
    try:
        detected = _probe_platform(vendor, host, port, username, password)
    except NetmikoAuthenticationException:
        return None, "login refused (check the username/password)"
    except NetmikoTimeoutException:
        return None, f"cannot reach {host}:{port} (timeout) — check the network and SSH allowaccess"
    except HostKeyError as e:
        # Reported verbatim: the message is a paragraph telling an operator which fingerprint was
        # expected and what to do about it, and wrapping it in a prefix only buries that.
        return None, str(e)

    if detected:
        result = _direct_backup(detected, host, port, username, password)
        # ถ้า direct backup ล้มเหลว (เช่น probe บอกผิด) → fallback cascade
        if result[0] is not None:
            return result
        print(f"    [smart] direct backup with {detected} failed → fallback cascade")

    return _cascade_backup(vendor, host, port, username, password)


# ─────────────────────────────────────────────────────────────────────────────
# Main job handler
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: the diff between this backup and the previous one is computed by the BACKEND
# (controller/automationjob.WorkerResult → diffSummary), which is the side that actually has the
# previous config in the database. A `_diff_summary` used to live here too, reading a
# `_prev_content` key off the queue message — but nothing has ever put that key there, so it
# always saw an empty string and returned "". It was removed rather than wired up: the backend
# already does the job, and doing it here would mean shipping the previous config over the queue
# for no gain.


def do_backup(msg: dict) -> None:
    job_id = msg["job_id"]
    name   = msg.get("name") or f"device-{msg.get('device_id')}"
    vendor_or_platform = msg.get("platform", DEFAULT_PLATFORM)
    host     = msg["host"]
    port     = int(msg.get("port") or 22)

    if vendor_or_platform not in VENDOR_PLATFORMS and vendor_or_platform not in BACKUP_CMD:
        known = ", ".join(VENDOR_PLATFORMS)
        _log(f"[*] job {job_id}: backup {name} ({host}, platform={vendor_or_platform})")
        _callback(f"/internal/jobs/{job_id}/start", {})
        _fail(job_id, f"unknown vendor/platform='{vendor_or_platform}' — supported: {known}")
        return

    _log(f"[*] job {job_id}: backup {name} ({host}, platform={vendor_or_platform})")
    _callback(f"/internal/jobs/{job_id}/start", {})

    # The credential is fetched HERE, after the job is marked RUNNING and before the first SSH
    # attempt: the queue message carries only a single-use token (job_credentials.py). A failure
    # is final — the token is spent, and retrying would only burn the device's lockout counter.
    try:
        username, password = credentials_for(msg)
    except CredentialError as e:
        _fail(job_id, str(e))
        return

    # Retries are a LOOP, not recursion. Each attempt is independent, so the call stack was
    # carrying nothing but the delay — and a bounded loop makes the retry budget obvious.
    result: tuple[str, str] | tuple[None, str] = (None, "no attempt made")
    for attempt in range(len(RETRY_DELAYS) + 1):
        if attempt > 0:
            _log(f"[*] job {job_id}: retry {attempt}/{len(RETRY_DELAYS)} — {name}")

        # ── vendor-level → smart probe + detect ─────────────────────────────
        if vendor_or_platform in VENDOR_PLATFORMS:
            result = _smart_backup(vendor_or_platform, host, port, username, password)
        else:
            result = _direct_backup(vendor_or_platform, host, port, username, password)

        if result[0] is not None:
            break
        if attempt < len(RETRY_DELAYS):
            wait = RETRY_DELAYS[attempt]
            _log(f"[!] job {job_id}: backup failed ({result[1]}) — retrying in {wait}s")
            time.sleep(wait)

    if result[0] is None:
        _fail(job_id, result[1])
        return

    platform, config_text = result
    meta = save(name, config_text, platform=platform)
    _log(f"[✓] job {job_id}: done platform={platform} commit={meta['git_commit']} lines={meta['lines']}")
    _callback(f"/internal/jobs/{job_id}/result", {
        "status":       "SUCCESS",
        "result":       f"backup ok ({platform}): {meta['lines']} lines, {meta['bytes']} bytes",
        "git_commit":   meta["git_commit"],
        "sha256":       meta["sha256"],
        "path":         meta["path"],
        "size_bytes":   meta["bytes"],
        "lines":        meta["lines"],
        "content":      config_text,
    })


def _redacted_redis_url(url: str) -> str:
    """The Redis URL with its password replaced, for printing.

    REDIS_URL carries a password now (docker-compose.yml), and this line used to print the whole
    URL on every worker boot — into the container log, which `docker compose logs` shows to anyone
    who can run it and which a log collector would ship off the host. The host and database are
    worth seeing on startup; the password is not, and a secret that is only in a log is still a
    secret that leaked.

    Deliberately textual rather than urllib.parse: a malformed URL must still print something
    useful here, not raise during boot logging.
    """
    if "@" not in url:
        return url
    head, _, tail = url.rpartition("@")
    scheme, sep, creds = head.partition("://")
    if not sep:
        return url
    user, has_pw, _pw = creds.partition(":")
    if not has_pw:
        return url
    return f"{scheme}://{user}:***@{tail}"


def main() -> int:
    secret_err = require_worker_secret(WORKER_SECRET)
    if secret_err:
        print(f"[FATAL] {secret_err}", file=sys.stderr, flush=True)
        return 1

    r = redis.Redis.from_url(REDIS_URL)
    _log(f"[worker] starting — Redis={_redacted_redis_url(REDIS_URL)} backend={BACKEND_URL}")
    _log(f"[worker] waiting on queues: {QUEUE_KEY}, {CONFIG_QUEUE_KEY}")

    _install_signal_handlers()
    stop_heartbeat = start_heartbeat(r)

    while not _shutdown.is_set():
        try:
            item = r.brpop([QUEUE_KEY, CONFIG_QUEUE_KEY], timeout=BRPOP_TIMEOUT)
        except redis.exceptions.TimeoutError:
            continue
        except redis.exceptions.ConnectionError as e:
            _log(f"[!] redis unreachable: {e} — retrying in 3s")
            # wait() rather than sleep(), so a SIGTERM arriving during a Redis outage is not sat
            # on for the full three seconds of every retry.
            _shutdown.wait(3)
            continue
        if item is None:
            continue

        _key, raw = item
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            _log(f"[!] queue message is not JSON: {raw!r}")
            continue

        job_type = msg.get("type")
        if job_type == "backup":
            do_backup(msg)
        elif job_type in ("config", "query"):
            handle_config(msg)
        else:
            _log(f"[!] unknown job type: {job_type}")

    # Past the loop: the flag is set and the job that was running (if any) has reported its result.
    stop_heartbeat.set()
    try:
        # Drop the heartbeat rather than letting it expire, so the Devices page says OFFLINE the
        # moment the worker leaves instead of up to HEARTBEAT_TTL later — a stop is a fact we know,
        # not something the console should have to infer from silence.
        r.delete(HEARTBEAT_KEY)
    except Exception:  # noqa: BLE001
        pass
    _log("[worker] stopped cleanly")
    return 0


if __name__ == "__main__":
    # KeyboardInterrupt is still caught, but it is now the SECOND Ctrl-C: the first is turned into
    # the graceful flag by _install_signal_handlers, and the second raises SystemExit from inside
    # the handler. This stays as the backstop for a Ctrl-C landing before the handlers are
    # installed — during require_worker_secret, or while Redis is being dialled.
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[worker] stopped")
