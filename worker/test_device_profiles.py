#!/usr/bin/env python3
"""
Tests สำหรับ device_profiles.py — FortiGate / FortiOS only

รัน:
    python -m unittest test_device_profiles -v

ประวัติของไฟล์นี้:
    เดิมเทสรองรับหลาย vendor (Cisco / H3C / Dell / Juniper / Aruba) แต่โปรเจกต์ตัดขอบเขต
    เหลือ Fortinet อย่างเดียวไปแล้ว — device_profiles.py มี "fortinet" เป็น key เดียวในทุก
    dict. เทสเก่าจึงล้ม 82 ตัว + error 7 ตัว ค้างไว้ ผลข้างเคียงที่แย่กว่าคือ ไม่มีใครกล้ารัน
    `python -m unittest` อีกเลย แปลว่าเทสตัวที่ยัง "จริง" อยู่ก็ไม่ถูกรันไปด้วย

    ไฟล์นี้จึงถูกเขียนใหม่ให้เทสเฉพาะ surface ที่มีอยู่จริง เทส Fortinet เดิมถูกยกมาครบ
    (identify_platform / normalize_config ENC / is_config_error) และเพิ่มเทสที่ "ตรึงขอบเขต"
    ไว้ด้วย — ถ้าวันหนึ่งมีคนเพิ่ม vendor กลับเข้ามา เทสกลุ่มนั้นจะล้มทันทีเพื่อเตือนว่าต้อง
    ตามไปเพิ่ม BACKUP_CMD / VENDOR_PROBE / error patterns / normalize rules ให้ครบด้วย
"""
from __future__ import annotations

import unittest

from device_profiles import (
    BACKUP_CMD,
    DEFAULT_PLATFORM,
    NEEDS_ENABLE,
    PAGING_DISABLE_CMD,
    VENDOR_PLATFORMS,
    VENDOR_PROBE,
    VERSION_CMD,
    identify_platform_from_output,
    is_config_error,
    normalize_config,
    vendor_dir,
)


# ─────────────────────────────────────────────────────────────────────────────
# Scope — Fortinet only
#
# Every table below is keyed by platform. They must agree with each other, or the worker picks a
# platform it then has no command for.
# ─────────────────────────────────────────────────────────────────────────────

class TestFortinetOnlyScope(unittest.TestCase):
    def test_backup_cmd_has_exactly_fortinet(self):
        self.assertEqual(set(BACKUP_CMD), {"fortinet"})
        self.assertEqual(BACKUP_CMD["fortinet"], "show full-configuration")

    def test_vendor_platforms_has_exactly_fortinet(self):
        self.assertEqual(set(VENDOR_PLATFORMS), {"fortinet"})
        self.assertEqual(VENDOR_PLATFORMS["fortinet"], ["fortinet"])

    def test_default_platform_is_backed_by_a_command(self):
        self.assertEqual(DEFAULT_PLATFORM, "fortinet")
        self.assertIn(DEFAULT_PLATFORM, BACKUP_CMD)

    def test_every_cascade_platform_has_a_backup_command(self):
        """A vendor whose cascade names a platform with no BACKUP_CMD would KeyError mid-backup."""
        for vendor, platforms in VENDOR_PLATFORMS.items():
            for platform in platforms:
                self.assertIn(platform, BACKUP_CMD,
                              f"vendor {vendor!r} cascades to {platform!r}, which has no backup command")

    def test_every_vendor_has_a_probe(self):
        for vendor in VENDOR_PLATFORMS:
            self.assertIn(vendor, VENDOR_PROBE, f"vendor {vendor!r} has no probe entry")

    def test_probe_entry_shape(self):
        for vendor, entry in VENDOR_PROBE.items():
            self.assertEqual(len(entry), 2, f"probe for {vendor!r} must be (driver, command)")
            driver, command = entry
            self.assertIn(driver, BACKUP_CMD, f"probe driver {driver!r} is not a known platform")
            self.assertTrue(command.strip(), f"probe command for {vendor!r} is empty")

    def test_fortinet_probe_command(self):
        self.assertEqual(VENDOR_PROBE["fortinet"], ("fortinet", "get system status"))

    def test_version_cmd_covers_every_platform(self):
        """Firmware identification refuses a platform that is missing from VERSION_CMD."""
        for platform in BACKUP_CMD:
            self.assertIn(platform, VERSION_CMD, f"{platform!r} has no version command")

    def test_fortigate_needs_no_enable_mode(self):
        """FortiGate admin sessions are already privileged — calling enable() would hang."""
        self.assertNotIn("fortinet", NEEDS_ENABLE)
        self.assertEqual(NEEDS_ENABLE, frozenset())

    def test_fortigate_needs_no_paging_command(self):
        """Netmiko's fortinet driver disables paging in session_preparation()."""
        self.assertNotIn("fortinet", PAGING_DISABLE_CMD)
        self.assertEqual(PAGING_DISABLE_CMD, {})


# ─────────────────────────────────────────────────────────────────────────────
# identify_platform_from_output — the probe's parser
# ─────────────────────────────────────────────────────────────────────────────

class TestIdentifyPlatform(unittest.TestCase):
    def test_fortigate_status_output(self):
        output = (
            "Version: FortiGate-80E v7.2.0,build1157,220217\n"
            "Virus-DB: 90.00534(2022-02-11 08:45)\n"
        )
        self.assertEqual(identify_platform_from_output(output), "fortinet")

    def test_lab_device_status_output(self):
        """The real answer from the lab FGT80E on FortiOS 7.2.10."""
        output = (
            "Version: FortiGate-80E v7.2.10,build1706,240912 (GA.M)\n"
            "Serial-Number: FGT80ETK19026638\n"
            "Hostname: NGFW-Testing\n"
        )
        self.assertEqual(identify_platform_from_output(output), "fortinet")

    def test_fortios(self):
        output = "FortiOS v7.4.1 build2463\nHostname: FW01\n"
        self.assertEqual(identify_platform_from_output(output), "fortinet")

    def test_fortinet_brand(self):
        output = "Fortinet FortiGate-60F\nSerial: FGT60F1234567890\n"
        self.assertEqual(identify_platform_from_output(output), "fortinet")

    def test_match_is_case_insensitive(self):
        for output in ("FORTIGATE-100F", "fortios v7.2", "FortiNet"):
            with self.subTest(output=output):
                self.assertEqual(identify_platform_from_output(output), "fortinet")

    def test_empty_string_returns_none(self):
        self.assertIsNone(identify_platform_from_output(""))

    def test_whitespace_only_returns_none(self):
        self.assertIsNone(identify_platform_from_output("   \n\t  \n"))

    def test_unrecognised_output_returns_none(self):
        """None means 'fall back to the cascade', not 'assume fortinet'."""
        self.assertIsNone(identify_platform_from_output("Cisco IOS Software, Version 15.2"))
        self.assertIsNone(identify_platform_from_output("some unrelated banner text"))

    def test_a_timed_out_probe_is_not_a_match(self):
        """_safe_send returns an "[error] …" string rather than raising; it must not parse."""
        self.assertIsNone(identify_platform_from_output("[error] ReadTimeout: timed out"))


# ─────────────────────────────────────────────────────────────────────────────
# vendor_dir — where a backup is filed
# ─────────────────────────────────────────────────────────────────────────────

class TestVendorDir(unittest.TestCase):
    def test_always_fortinet(self):
        for platform in ("fortinet", "", "totally_unknown_platform"):
            with self.subTest(platform=platform):
                self.assertEqual(vendor_dir(platform), "fortinet")

    def test_result_is_a_safe_path_segment(self):
        """The value is joined into a filesystem path in backup_fortigate.save()."""
        result = vendor_dir("fortinet")
        for bad in ("/", "\\", "..", "\0"):
            self.assertNotIn(bad, result)


# ─────────────────────────────────────────────────────────────────────────────
# normalize_config — mask secrets so a diff shows real changes only
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalizeConfigFortinet(unittest.TestCase):
    def test_masks_enc_secret(self):
        text = "set password ENC AK1abcXYZ0123456789+/=="
        self.assertEqual(normalize_config(text, "fortinet"), "set password ENC ***")

    def test_masks_multiple_enc_secrets_independently(self):
        text = "set passwd ENC abc123\nset private-key ENC def456==\n"
        out = normalize_config(text, "fortinet")
        self.assertEqual(out, "set passwd ENC ***\nset private-key ENC ***")

    def test_does_not_touch_unrelated_lines(self):
        text = "config system interface\nedit port1\nset status up\nend"
        self.assertEqual(normalize_config(text, "fortinet"), text)

    def test_keeps_indentation(self):
        """FortiGate indents nested blocks; losing that would make every diff enormous."""
        text = "config system interface\n    edit \"port1\"\n        set ip 10.0.0.1 255.255.255.0\n    next\nend"
        self.assertEqual(normalize_config(text, "fortinet"), text)

    def test_two_backups_differing_only_by_secret_normalise_equal(self):
        """The point of masking: a re-encrypted secret must not look like a config change."""
        before = 'config system admin\n    edit "admin"\n        set password ENC AAAAsecretONE==\n    next\nend'
        after = 'config system admin\n    edit "admin"\n        set password ENC BBBBsecretTWO==\n    next\nend'
        self.assertEqual(normalize_config(before, "fortinet"), normalize_config(after, "fortinet"))

    def test_a_real_change_still_shows(self):
        before = 'config system interface\n    edit "port1"\n        set ip 10.0.0.1 255.255.255.0\n    next\nend'
        after = 'config system interface\n    edit "port1"\n        set ip 10.0.0.2 255.255.255.0\n    next\nend'
        self.assertNotEqual(normalize_config(before, "fortinet"), normalize_config(after, "fortinet"))

    def test_unknown_platform_passes_through_unchanged(self):
        text = "set password ENC secret"
        self.assertEqual(normalize_config(text, "not-a-platform"), text)

    def test_normalises_line_endings(self):
        """Backups arrive over SSH with CRLF; that must not read as a whole-file change."""
        self.assertEqual(
            normalize_config("line one\r\nline two\r\n", "fortinet"),
            normalize_config("line one\nline two\n", "fortinet"),
        )


# ─────────────────────────────────────────────────────────────────────────────
# is_config_error — refuse to save a "backup" that is really an error message
# ─────────────────────────────────────────────────────────────────────────────

class TestIsConfigError(unittest.TestCase):
    def test_empty_string_is_an_error(self):
        err = is_config_error("", "fortinet")
        self.assertIsNotNone(err)
        self.assertIn("Empty output", err)

    def test_whitespace_only_is_an_error(self):
        self.assertIsNotNone(is_config_error("   \n\t \n", "fortinet"))

    def test_detects_command_fail(self):
        err = is_config_error("Command fail. Return code -61", "fortinet")
        self.assertIsNotNone(err)
        self.assertIn("CLI error", err)

    def test_detects_unknown_action(self):
        self.assertIsNotNone(is_config_error("Unknown action 0", "fortinet"))

    def test_detects_object_does_not_exist(self):
        self.assertIsNotNone(is_config_error("object does not exist", "fortinet"))

    def test_detects_an_error_on_a_later_line(self):
        """The patterns are multiline: an error after a banner must still be caught."""
        output = "NGFW-Testing # show full-configuration\nCommand fail. Return code -61\n"
        self.assertIsNotNone(is_config_error(output, "fortinet"))

    def test_clean_fortigate_config_is_not_an_error(self):
        output = (
            "config system global\n"
            '    set hostname "NGFW-Testing"\n'
            "end\n"
            "config firewall policy\n"
            "    edit 1\n"
            '        set name "LAN-to-WAN"\n'
            "    next\n"
            "end\n"
        )
        self.assertIsNone(is_config_error(output, "fortinet"))

    def test_config_merely_mentioning_an_error_word_is_not_an_error(self):
        """The patterns anchor to the start of a line, so a comment must not trip them."""
        output = 'config system global\n    set comment "do not let this command fail"\nend\n'
        self.assertIsNone(is_config_error(output, "fortinet"))

    def test_unknown_platform_only_catches_empty_output(self):
        self.assertIsNone(is_config_error("some output", "not-a-platform"))
        self.assertIsNotNone(is_config_error("", "not-a-platform"))

    def test_error_message_includes_a_snippet_of_what_came_back(self):
        """Without the snippet the operator has no idea what the device actually said."""
        err = is_config_error("Command fail. Return code -61", "fortinet")
        self.assertIn("Command fail", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
