#!/usr/bin/env python3
"""
POC: Backup FortiGate running-config ผ่าน SSH (Netmiko) แล้วเก็บลงไฟล์ + Git commit.

นี่คือ "core logic" ของ Python automation worker ที่จะถูกห่อด้วย Go + Redis + React ภายหลัง
ตอนนี้รันมือก่อนเพื่อพิสูจน์ว่า end-to-end ทำงานได้จริงกับ FortiGate-80E

วิธีรัน (read-only ปลอดภัย — แค่ดึง config ไม่แก้ไขอะไรบนอุปกรณ์):
    cd Project
    FW_HOST=192.168.1.99 FW_USER=admin worker/.venv/bin/python worker/backup_fortigate.py
    # จะถาม password แบบไม่โชว์บนจอ (getpass) — ไม่เก็บลงไฟล์/Git

ตัวแปร env:
    FW_HOST   IP ของ FortiGate           (default 192.168.1.99)
    FW_USER   ชื่อ admin                  (default admin)
    FW_PASS   password (ถ้าไม่ตั้ง จะถามแบบ getpass)
    FW_NAME   ชื่ออุปกรณ์สำหรับตั้งชื่อไฟล์ (default = hostname จาก FortiGate)
    NO_GIT    ถ้าตั้งค่าใด ๆ จะข้ามการ commit Git
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

from netmiko import ConnectHandler
from netmiko.exceptions import (
    NetmikoAuthenticationException,
    NetmikoTimeoutException,
)

from device_profiles import vendor_dir
from host_keys import connect_checked

# โฟลเดอร์เก็บ backup (เป็น Git repo แยกของ config โดยเฉพาะ)
REPO_DIR = Path(__file__).resolve().parent / "config-backups"
BACKUP_CMD = "show full-configuration"


def connect(host: str, user: str, password: str) -> ConnectHandler:
    """เปิด SSH session ไป FortiGate. Netmiko 'fortinet' จัดการปิด paging ให้อัตโนมัติ.

    connect_checked, not ConnectHandler: the device's SSH host key is verified against the
    console's pins before this password goes anywhere (host_keys.py).
    """
    return connect_checked(
        device_type="fortinet",
        host=host,
        username=user,
        password=password,
        # FortiOS 7.2 รับ modern ciphers ได้ ไม่ต้องเปิด legacy
        fast_cli=False,
        conn_timeout=15,
    )


def fetch_config(conn: ConnectHandler) -> tuple[str, str]:
    """คืน (hostname, running_config). hostname ใช้ตั้งชื่อไฟล์."""
    hostname = conn.find_prompt().rstrip("#").strip() or "fortigate"
    config = conn.send_command(BACKUP_CMD, read_timeout=120)
    return hostname, config


# ─────────────────────────────────────────────────────────────────────────────
# File naming
# ─────────────────────────────────────────────────────────────────────────────

# Characters that may not appear in one path component: the separators themselves, NUL, the
# control range, and the set Windows reserves (this repo is developed on Windows and the backup
# directory is bind-mounted, so a name legal on Linux can still break the host side).
_UNSAFE_NAME_CHARS = set('/' + chr(92) + chr(0) + '<>:"|?*') | {chr(c) for c in range(32)}

_MAX_NAME = 80


def safe_filename(device: str) -> str:
    """Turn a device NAME into one path component that cannot escape the backup directory.

    The name comes from the database — an admin types it when adding the firewall — and it used to
    be interpolated straight into a path: ``REPO_DIR / vendor / f"{device}.conf"``. A device named
    ``../../app/x`` therefore wrote a file outside the backup repo, with the worker's rights, and
    the content of that file is attacker-chosen because it is whatever the "device" answers with.
    Naming a device is an ordinary action in this console; writing anywhere on the worker's
    filesystem is not.

    What this does NOT do is reduce the name to ASCII. Devices here are named in Thai as often as
    in English, and mapping every non-ASCII character to "_" would give two firewalls the same
    filename — a silently overwritten backup is worse than an awkward one. Unicode letters are
    perfectly good in a filename; separators and control characters are the problem, so those are
    what is replaced.

    A leading dot is stripped as well: it would hide the file, and ``.git`` would land inside the
    backup repo's own metadata.
    """
    base = device.replace("\\", "/").split("/")[-1]
    cleaned = "".join("_" if ch in _UNSAFE_NAME_CHARS else ch for ch in base)
    cleaned = cleaned.strip().strip(" .")[:_MAX_NAME].strip(" .")
    return cleaned or "device"


def save(device: str, config: str, platform: str = "fortinet") -> dict:
    """เขียนไฟล์ <vendor>/<device>.conf, snapshot รายครั้งใน history/, แล้ว git commit."""
    REPO_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc)

    # ไฟล์ล่าสุด (overwrite) — ใช้ดู diff ระหว่างครั้งล่าสุด ๆ ด้วย git
    latest = REPO_DIR / vendor_dir(platform) / f"{safe_filename(device)}.conf"
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(config)

    sha = hashlib.sha256(config.encode()).hexdigest()
    git_commit = _git_commit(device, ts) if "NO_GIT" not in os.environ else "skipped"

    return {
        "device": device,
        "path": str(latest.relative_to(REPO_DIR.parent)),
        "bytes": len(config),
        "lines": config.count("\n") + 1,
        "sha256": sha[:16],
        "git_commit": git_commit,
        "timestamp": ts.isoformat(),
    }


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(REPO_DIR), *args],
        capture_output=True, text=True,
    )


def _git_commit(device: str, ts: datetime) -> str:
    """init repo ถ้ายังไม่มี แล้ว commit เฉพาะเมื่อมีการเปลี่ยนแปลง."""
    if not (REPO_DIR / ".git").exists():
        _git("init", "-q")
        _git("config", "user.email", "worker@network-automation.local")
        _git("config", "user.name", "automation-worker")
        (REPO_DIR / "README.md").write_text("# Network Config Backups\n")

    _git("add", "-A")
    status = _git("status", "--porcelain").stdout.strip()
    if not status:
        return "no-change"
    _git("commit", "-q", "-m", f"backup({device}) {ts.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    return _git("rev-parse", "--short", "HEAD").stdout.strip()


def main() -> int:
    host = os.environ.get("FW_HOST", "192.168.1.99")
    user = os.environ.get("FW_USER", "admin")
    password = os.environ.get("FW_PASS") or getpass(f"Password for {user}@{host}: ")

    print(f"[*] connecting to {user}@{host} ...")
    try:
        conn = connect(host, user, password)
    except NetmikoAuthenticationException:
        print("[!] login refused — check the username/password", file=sys.stderr)
        return 2
    except NetmikoTimeoutException:
        print(f"[!] cannot reach {host}:22 — check the network, and allowaccess ssh on the device", file=sys.stderr)
        return 3
    except Exception as e:  # noqa: BLE001
        print(f"[!] connection failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    try:
        device_default, config = fetch_config(conn)
    finally:
        conn.disconnect()

    device = os.environ.get("FW_NAME", device_default)
    if not config.strip() or "Permission denied" in config:
        print("[!] could not read the config (the account may be read-only without config rights)", file=sys.stderr)
        return 4

    meta = save(device, config)
    print("\n[✓] Backup done")
    for k, v in meta.items():
        print(f"    {k:12}: {v}")
    print(f"\n    file:     {REPO_DIR / 'fortinet' / (device + '.conf')}")
    print(f"    diff:     git -C {REPO_DIR} log --oneline | head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
