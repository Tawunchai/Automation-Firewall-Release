#!/usr/bin/env python3
"""
device_profiles — FortiGate / FortiOS only

Platform: fortinet (Netmiko driver)
All backup and config-push operations target FortiGate firewalls.
"""
from __future__ import annotations

import re

# ─────────────────────────────────────────────────────────────────────────────
# Backup command
# ─────────────────────────────────────────────────────────────────────────────
BACKUP_CMD: dict[str, str] = {
    "fortinet": "show full-configuration",
}

DEFAULT_PLATFORM = "fortinet"

# FortiGate does not require entering enable mode — always in privileged context
NEEDS_ENABLE: frozenset[str] = frozenset()

# ─────────────────────────────────────────────────────────────────────────────
# Vendor → platform mapping (FortiGate only)
# ─────────────────────────────────────────────────────────────────────────────
VENDOR_PLATFORMS: dict[str, list[str]] = {
    "fortinet": ["fortinet"],
}

# ─────────────────────────────────────────────────────────────────────────────
# Probe config: vendor → (driver, command) for platform detection
# ─────────────────────────────────────────────────────────────────────────────
VENDOR_PROBE: dict[str, tuple[str, str]] = {
    "fortinet": ("fortinet", "get system status"),
}


def vendor_dir(platform: str) -> str:
    """Storage folder name for backups (always fortinet)."""
    return "fortinet"


# FortiGate: Netmiko session_preparation() disables paging automatically
PAGING_DISABLE_CMD: dict[str, str] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Platform detection from probe output
# ─────────────────────────────────────────────────────────────────────────────

def identify_platform_from_output(output: str) -> str | None:
    """Parse FortiGate 'get system status' output → return 'fortinet' or None."""
    if not output or not output.strip():
        return None
    low = output.lower()
    if "fortigate" in low or "fortios" in low or "fortinet" in low:
        return "fortinet"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# CLI error patterns: detect error responses from device before saving backup
# ─────────────────────────────────────────────────────────────────────────────

_CLI_ERROR_PATTERNS: dict[str, list[re.Pattern]] = {
    "fortinet": [
        re.compile(r"^Command fail\.",      re.M),
        re.compile(r"^Unknown action\b",    re.M),
        re.compile(r"^object does not exist\b", re.M),
    ],
}

def is_config_error(text: str, platform: str) -> str | None:
    """Return None if output looks like valid config; return error description otherwise."""
    if not text or not text.strip():
        return "Empty output — check admin permissions and SSH access"
    for pat in _CLI_ERROR_PATTERNS.get(platform, []):
        if pat.search(text):
            snippet = text.strip()[:120].replace("\n", " | ")
            return f"Device returned CLI error — {snippet!r}"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Normalize patterns: mask sensitive / volatile fields before diffing
# ─────────────────────────────────────────────────────────────────────────────
_NORMALIZE_PATTERNS: dict[str, list[tuple[re.Pattern, str]]] = {
    "fortinet": [
        (re.compile(r"(\bENC\s+)\S+"), r"\1***"),
    ],
}


def normalize_config(text: str, platform: str) -> str:
    """Mask passwords/timestamps so diff only shows real config changes."""
    out = text
    for pat, repl in _NORMALIZE_PATTERNS.get(platform, []):
        out = pat.sub(repl, out)
    return "\n".join(out.splitlines())


# ─────────────────────────────────────────────────────────────────────────────
# Version command for firmware identification
# ─────────────────────────────────────────────────────────────────────────────
VERSION_CMD: dict[str, str] = {
    "fortinet": "get system status",  # returns: Version: FortiGate-80E v7.4.x-buildXXXX
}
