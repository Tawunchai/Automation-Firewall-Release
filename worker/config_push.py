#!/usr/bin/env python3
"""
Config push (bulk/parallel) — รับงานแม่ 1 ข้อความจาก Redis แล้ว fan-out ยิง config
เข้าหลายอุปกรณ์ "พร้อมกัน" ด้วย ThreadPoolExecutor แล้วรายงานผล "รายอุปกรณ์" กลับ Go backend

flow ต่อ 1 งานแม่ (deploy):
    POST /internal/config-deploys/{deploy_id}/start
    ── ขนาน ต่อ target ──
      _resolve_conn(): probe detect platform → enable → disable paging
      push + snapshot diff
      POST /internal/config-deploys/{deploy_id}/device-result

_safe_send() strategy (ป้องกัน ReadTimeout บน Dell N-series / firmware quirks):
  1. send_command()         — prompt-detection (fast, แต่ fail ถ้า prompt pattern ไม่ตรง)
  2. send_command_timing()  — timing-based fallback (ไม่พึ่ง prompt, รองรับทุก device)
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from netmiko import ConnectHandler
from netmiko.exceptions import (
    NetmikoAuthenticationException,
    NetmikoTimeoutException,
)

from host_keys import HostKeyError, connect_checked

from job_credentials import CredentialError, credentials_for

from device_profiles import (
    BACKUP_CMD,
    DEFAULT_PLATFORM,
    NEEDS_ENABLE,
    PAGING_DISABLE_CMD,
    VENDOR_PLATFORMS,
    VENDOR_PROBE,
    identify_platform_from_output,
    is_config_error,
    normalize_config,
)

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:9000").rstrip("/")
WORKER_SECRET = os.environ.get("WORKER_SHARED_SECRET", "dev-worker-secret-change-me")
MAX_PARALLEL = int(os.environ.get("CONFIG_MAX_PARALLEL", "10"))


def _post(path: str, payload: dict) -> None:
    url = f"{BACKEND_URL}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json", "X-Worker-Secret": WORKER_SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        print(f"[!] callback {path} HTTP {e.code}: {e.read().decode(errors='ignore')}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[!] callback {path} error: {e}", file=sys.stderr)


def _unified_diff(before: str, after: str, name: str, platform: str) -> str:
    diff = difflib.unified_diff(
        normalize_config(before, platform).splitlines(),
        normalize_config(after, platform).splitlines(),
        fromfile=f"{name} (before)", tofile=f"{name} (after)", lineterm="",
    )
    return "\n".join(diff)


# ─────────────────────────────────────────────────────────────────────────────
# Safe send — ป้องกัน ReadTimeout จาก prompt detection ล้มเหลว
# ─────────────────────────────────────────────────────────────────────────────

def _safe_send(conn, cmd: str, timeout: int = 120) -> str:
    """ส่งคำสั่ง → คืน output string (ไม่ throw)

    Strategy:
      1. send_command() : รอ prompt pattern — เร็ว แต่ล้มเหลวถ้า device echo ผิดปกติ
         (เช่น Dell N-series DNOS6 บางรุ่น / firmware ที่ไม่ echo command กลับ)
      2. send_command_timing() : รอ output หยุดไหล — ช้ากว่าแต่รองรับทุก device
    """
    try:
        return conn.send_command(
            cmd,
            read_timeout=timeout,
            strip_prompt=True,
            strip_command=True,
        )
    except Exception:  # noqa: BLE001
        pass
    # Fallback: timing-based (no prompt detection)
    try:
        return conn.send_command_timing(
            cmd,
            delay_factor=3,
            max_loops=int(timeout / 0.3),  # ≈ timeout seconds total
            strip_prompt=True,
            strip_command=True,
        )
    except Exception as e:  # noqa: BLE001
        return f"[error] {type(e).__name__}: {e}"


# ─────────────────────────────────────────────────────────────────────────────
# Connection resolver
# ─────────────────────────────────────────────────────────────────────────────

def _probe_detect(
    vendor: str, host: str, port: int, username: str, password: str,
) -> str | None:
    """Probe device to identify actual platform (ไม่ throw — คืน None ถ้าล้มเหลว)"""
    probe_entry = VENDOR_PROBE.get(vendor)
    if not probe_entry:
        return None
    probe_driver, probe_cmd = probe_entry
    try:
        conn = connect_checked(
            device_type=probe_driver, host=host, port=port,
            username=username, password=password,
            secret=password, fast_cli=False, conn_timeout=15,
        )
        try:
            out = _safe_send(conn, probe_cmd, timeout=30)
        finally:
            try:
                conn.disconnect()
            except Exception:  # noqa: BLE001
                pass
        return identify_platform_from_output(out)
    except (NetmikoAuthenticationException, NetmikoTimeoutException):
        raise
    except Exception:  # noqa: BLE001
        return None


def _resolve_conn(target: dict) -> tuple[ConnectHandler, str]:
    """เชื่อมต่อ + detect platform + enable + disable paging

    คืน (conn, actual_platform) หรือ raise exception

    flow:
      1. vendor-level → probe detect → platform จริง (fallback: platform แรกใน cascade)
      2. specific platform → ใช้ตรง ๆ
      3. เชื่อมต่อ + enter privileged mode (NEEDS_ENABLE)
      4. ส่ง paging disable command (กัน --More-- hang)
    """
    host     = target["host"]
    port     = int(target.get("port") or 22)
    # Each target carries its OWN single-use token: a deploy fans out to several firewalls and the
    # logins can differ per device (job_credentials.py). Spent here, immediately before connecting.
    username, password = credentials_for(target)
    vendor_or_platform = target.get("platform", DEFAULT_PLATFORM)

    # ── vendor-level: probe detect ───────────────────────────────────────────
    if vendor_or_platform in VENDOR_PLATFORMS:
        vendor = vendor_or_platform
        actual_platform = _probe_detect(vendor, host, port, username, password)
        if actual_platform is None:
            actual_platform = VENDOR_PLATFORMS[vendor][0]
            print(f"    [resolve] probe inconclusive → fallback platform={actual_platform}")
    else:
        actual_platform = vendor_or_platform

    # ── เชื่อมต่อด้วย platform จริง ─────────────────────────────────────────
    conn = connect_checked(
        device_type=actual_platform,
        host=host, port=port,
        username=username, password=password,
        secret=password,
        fast_cli=False,
        conn_timeout=15,
    )

    # ── enter privileged mode ─────────────────────────────────────────────────
    if actual_platform in NEEDS_ENABLE:
        try:
            if not conn.check_enable_mode():
                conn.enable(cmd_verify=False)
        except Exception:  # noqa: BLE001
            pass

    # ── disable paging (belt-and-suspenders) ─────────────────────────────────
    # Netmiko session_preparation() ส่งคำสั่งนี้แล้วรอบหนึ่ง แต่ Dell N-series
    # บาง firmware paging reset หลัง enable → ส่งซ้ำเพื่อกัน "--More--" hang
    paging_cmd = PAGING_DISABLE_CMD.get(actual_platform)
    if paging_cmd:
        try:
            conn.send_command_timing(paging_cmd, delay_factor=1, max_loops=30)
        except Exception:  # noqa: BLE001
            pass

    return conn, actual_platform


# ─────────────────────────────────────────────────────────────────────────────
# Push one device
# ─────────────────────────────────────────────────────────────────────────────

def _push_one(target: dict, commands: list[str]) -> dict:
    """push config เข้า 1 อุปกรณ์ + snapshot before/after + diff
    คืน dict ผลลัพธ์ (ไม่ throw)"""
    result_id = target["result_id"]
    name = target.get("name") or f"device-{target.get('device_id')}"
    base = {"result_id": result_id}

    try:
        conn, actual_platform = _resolve_conn(target)
    except CredentialError as e:
        return {**base, "status": "FAILED", "error": str(e)}
    except HostKeyError as e:
        # Verbatim: the message names the expected fingerprint and what to do about it.
        return {**base, "status": "FAILED", "error": str(e)}
    except NetmikoAuthenticationException:
        return {**base, "status": "FAILED", "error": "login refused (check the username/password)"}
    except NetmikoTimeoutException:
        return {**base, "status": "FAILED",
                "error": f"cannot reach {target.get('host')}:{target.get('port', 22)} (network, or allowaccess ssh)"}
    except Exception as e:  # noqa: BLE001
        return {**base, "status": "FAILED", "error": f"connection failed: {type(e).__name__}: {e}"}

    backup_cmd = BACKUP_CMD.get(actual_platform, BACKUP_CMD[DEFAULT_PLATFORM])

    try:
        # ── snapshot ก่อน ─────────────────────────────────────────────────────
        before = _safe_send(conn, backup_cmd, timeout=120)
        if is_config_error(before, actual_platform):
            before = ""

        # ── APPLY ────────────────────────────────────────────────────────────
        try:
            output = conn.send_config_set(commands, read_timeout=120)
        except Exception as e:  # noqa: BLE001
            # fallback: ส่งทีละ command
            parts = []
            for cmd in commands:
                parts.append(_safe_send(conn, cmd, timeout=60))
            output = "\n".join(parts)

        # ── snapshot หลัง ────────────────────────────────────────────────────
        after = _safe_send(conn, backup_cmd, timeout=120)
        if is_config_error(after, actual_platform):
            after = ""

        diff = _unified_diff(before, after, name, actual_platform) if (before and after) else ""
        res = {
            **base, "status": "SUCCESS",
            "output": output, "diff": diff, "changed": bool(diff.strip()),
        }
        if before:
            res["before_content"] = before
            res["before_sha"]     = hashlib.sha256(before.encode()).hexdigest()[:16]
            res["before_lines"]   = before.count("\n") + 1
            res["before_bytes"]   = len(before)
        return res

    except Exception as e:  # noqa: BLE001
        return {**base, "status": "FAILED", "error": f"sending the config failed: {type(e).__name__}: {e}"}
    finally:
        try:
            conn.disconnect()
        except Exception:  # noqa: BLE001
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Query one device (read-only show/get/display)
# ─────────────────────────────────────────────────────────────────────────────

def _query_one(target: dict, commands: list[str]) -> dict:
    """รัน show/get/display commands บนอุปกรณ์ → คืน output ดิบ
    ใช้กับ AI assistant query — ไม่มี diff/rollback
    คืน dict ผลลัพธ์ (ไม่ throw)"""
    result_id = target["result_id"]
    base = {"result_id": result_id}

    try:
        conn, actual_platform = _resolve_conn(target)
    except CredentialError as e:
        return {**base, "status": "FAILED", "error": str(e)}
    except HostKeyError as e:
        # Verbatim: the message names the expected fingerprint and what to do about it.
        return {**base, "status": "FAILED", "error": str(e)}
    except NetmikoAuthenticationException:
        return {**base, "status": "FAILED", "error": "login refused (check the username/password)"}
    except NetmikoTimeoutException:
        return {**base, "status": "FAILED",
                "error": f"cannot reach {target.get('host')}:{target.get('port', 22)} (network, or allowaccess ssh)"}
    except Exception as e:  # noqa: BLE001
        return {**base, "status": "FAILED", "error": f"connection failed: {type(e).__name__}: {e}"}

    try:
        parts = []
        for cmd in commands:
            out = _safe_send(conn, cmd, timeout=120)
            parts.append(f"$ {cmd}\n{out}")
        return {**base, "status": "SUCCESS", "output": "\n\n".join(parts)}
    except Exception as e:  # noqa: BLE001
        return {**base, "status": "FAILED", "error": f"running the commands failed: {type(e).__name__}: {e}"}
    finally:
        try:
            conn.disconnect()
        except Exception:  # noqa: BLE001
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Fan-out entry point
# ─────────────────────────────────────────────────────────────────────────────

def handle_config(msg: dict) -> None:
    deploy_id = msg["deploy_id"]
    targets   = msg.get("targets", [])
    commands  = msg.get("commands", [])
    job_type  = msg.get("type", "config")

    if job_type == "query":
        print(f"[*] config deploy {deploy_id}: QUERY {len(commands)} command(s) → {len(targets)} device(s)")
        _post(f"/internal/config-deploys/{deploy_id}/start", {})
        for t in targets:
            res = _query_one(t, commands)
            tag = "✓" if res["status"] == "SUCCESS" else "✗"
            print(f"    {tag} deploy {deploy_id} / {t.get('name', '?')}: {res['status']}")
            _post(f"/internal/config-deploys/{deploy_id}/device-result", res)
        print(f"[✓] config deploy {deploy_id}: reported back for all {len(targets)} device(s)")
        return

    print(f"[*] config deploy {deploy_id}: APPLY {len(commands)} line(s) → {len(targets)} device(s) ({MAX_PARALLEL} in parallel)")
    _post(f"/internal/config-deploys/{deploy_id}/start", {})

    workers = min(MAX_PARALLEL, max(1, len(targets)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_push_one, t, commands): t for t in targets}
        for fut in as_completed(futures):
            res = fut.result()
            tag = "✓" if res["status"] == "SUCCESS" else "✗"
            print(f"    {tag} deploy {deploy_id} / {futures[fut].get('name', '?')}: {res['status']}")
            _post(f"/internal/config-deploys/{deploy_id}/device-result", res)

    print(f"[✓] config deploy {deploy_id}: reported back for all {len(targets)} device(s)")
