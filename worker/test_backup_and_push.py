#!/usr/bin/env python3
"""
Tests for backup_fortigate.py and config_push.py — the two worker modules that had none.

    python -m unittest test_backup_and_push -v

Between them they are what actually touches a firewall: one pulls the running configuration and
commits it to git, the other pushes commands and reports what changed. Neither was covered, so
nothing checked the parts that are easy to get quietly wrong and expensive to get wrong at 3am:

  · the metadata a backup reports (byte and line counts, the sha, the stored path) — the Backups
    page and Config Drift both read those, and a wrong line count is invisible until a diff
    disagrees with the file;
  · that a backup does not commit when nothing changed, which is what keeps the git history a
    record of CHANGES rather than one commit per night per device;
  · that _safe_send never raises, because a raise there aborts a push mid-way through a device's
    command list and leaves the firewall half-configured;
  · that the diff a push reports is computed on NORMALISED text, so a rotated password hash does
    not read as a configuration change.

The netmiko/redis stubs are the same trick test_worker.py uses and for the same reason: both
libraries exist only in the worker container, and a test that runs nowhere else is a test nobody
runs.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


from stub_modules import install_paramiko_stub


def _install_stubs() -> None:
    """Minimal netmiko so the modules under test import outside the worker container."""
    # Unconditional and first: the netmiko guard below returns early when another test module got
    # there first, and paramiko would then never be stubbed at all.
    install_paramiko_stub()
    if "netmiko" in sys.modules:
        return
    netmiko = types.ModuleType("netmiko")

    class _ConnectHandler:
        def __init__(self, **kw):
            self.kw = kw

    netmiko.ConnectHandler = _ConnectHandler

    exceptions = types.ModuleType("netmiko.exceptions")
    for name in (
        "NetmikoAuthenticationException",
        "NetmikoTimeoutException",
        "ReadTimeout",
    ):
        setattr(exceptions, name, type(name, (Exception,), {}))
    netmiko.exceptions = exceptions

    sys.modules["netmiko"] = netmiko
    sys.modules["netmiko.exceptions"] = exceptions


_install_stubs()

import backup_fortigate  # noqa: E402
import config_push  # noqa: E402


class SaveMetadataTests(unittest.TestCase):
    """What `save()` reports is what the Backups page and Config Drift read back."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._repo = Path(self._tmp.name) / "config-backups"
        self._patch = mock.patch.object(backup_fortigate, "REPO_DIR", self._repo)
        self._patch.start()
        # NO_GIT keeps these cases about the metadata; the git behaviour has its own case below.
        self._env = mock.patch.dict(os.environ, {"NO_GIT": "1"})
        self._env.start()

    def tearDown(self) -> None:
        self._env.stop()
        self._patch.stop()
        self._tmp.cleanup()

    def test_writes_the_config_under_the_vendor_directory(self) -> None:
        meta = backup_fortigate.save("fgt-1", "config system global\nend\n")

        written = self._repo / "fortinet" / "fgt-1.conf"
        self.assertTrue(written.exists(), "the backup file was not written")
        self.assertEqual(written.read_text(), "config system global\nend\n")
        # The path is reported RELATIVE to the repo's parent, which is what the download endpoint
        # joins against. An absolute path here would 404 on the way back.
        self.assertFalse(Path(meta["path"]).is_absolute())
        self.assertIn("fgt-1.conf", meta["path"])

    def test_counts_bytes_and_lines_the_way_the_pages_expect(self) -> None:
        config = "line one\nline two\nline three\n"
        meta = backup_fortigate.save("fgt-1", config)

        self.assertEqual(meta["bytes"], len(config))
        # Trailing newline included: `count("\n") + 1` is 4 for three lines plus the final newline,
        # which matches what an editor shows. Pinned because Config Drift reports "+N/-N lines"
        # against it and the two must agree.
        self.assertEqual(meta["lines"], config.count("\n") + 1)

    def test_the_sha_is_of_the_config_and_is_stable(self) -> None:
        a = backup_fortigate.save("fgt-1", "same text")
        b = backup_fortigate.save("fgt-2", "same text")
        c = backup_fortigate.save("fgt-3", "different text")

        self.assertEqual(a["sha256"], b["sha256"], "identical configs must hash the same")
        self.assertNotEqual(a["sha256"], c["sha256"])
        self.assertEqual(len(a["sha256"]), 16, "the stored sha is the truncated form")

    def test_the_timestamp_is_utc_and_parseable(self) -> None:
        meta = backup_fortigate.save("fgt-1", "x")
        parsed = datetime.fromisoformat(meta["timestamp"])
        self.assertIsNotNone(parsed.tzinfo, "a naive timestamp cannot be compared across hosts")
        self.assertEqual(parsed.utcoffset(), timezone.utc.utcoffset(None))

    def test_an_empty_config_still_produces_a_record(self) -> None:
        # A device that answers with nothing is a failure worth SEEING rather than crashing on.
        meta = backup_fortigate.save("fgt-1", "")
        self.assertEqual(meta["bytes"], 0)
        self.assertEqual(meta["lines"], 1)


def _git_available() -> bool:
    try:
        subprocess.run(["git", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


@unittest.skipUnless(_git_available(), "git is not on PATH")
class GitCommitTests(unittest.TestCase):
    """The history has to be a record of CHANGES, not one commit per run."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._repo = Path(self._tmp.name) / "config-backups"
        self._patch = mock.patch.object(backup_fortigate, "REPO_DIR", self._repo)
        self._patch.start()
        os.environ.pop("NO_GIT", None)

    def tearDown(self) -> None:
        self._patch.stop()
        self._tmp.cleanup()

    def test_the_second_identical_backup_commits_nothing(self) -> None:
        first = backup_fortigate.save("fgt-1", "config a\nend\n")
        self.assertNotIn(first["git_commit"], ("", "no-change"),
                         "the first backup should have produced a commit")

        again = backup_fortigate.save("fgt-1", "config a\nend\n")
        self.assertEqual(again["git_commit"], "no-change",
                         "an unchanged config committed again — the history would grow one commit "
                         "per device per night and stop showing when anything actually changed")

    def test_a_changed_config_does_commit(self) -> None:
        backup_fortigate.save("fgt-1", "config a\nend\n")
        changed = backup_fortigate.save("fgt-1", "config b\nend\n")
        self.assertNotEqual(changed["git_commit"], "no-change")


class SafeSendTests(unittest.TestCase):
    """_safe_send is the reason a push does not abort halfway through a device."""

    class _Conn:
        def __init__(self, first=None, timing=None):
            self._first, self._timing = first, timing
            self.calls: list[str] = []

        def send_command(self, cmd, **_kw):
            self.calls.append("send_command")
            if isinstance(self._first, Exception):
                raise self._first
            return self._first

        def send_command_timing(self, cmd, **_kw):
            self.calls.append("send_command_timing")
            if isinstance(self._timing, Exception):
                raise self._timing
            return self._timing

    def test_uses_the_fast_path_when_it_works(self) -> None:
        conn = self._Conn(first="ok")
        self.assertEqual(config_push._safe_send(conn, "get system status"), "ok")
        self.assertEqual(conn.calls, ["send_command"], "the timing fallback should not have run")

    def test_falls_back_to_timing_when_prompt_detection_fails(self) -> None:
        conn = self._Conn(first=RuntimeError("no prompt"), timing="ok from timing")
        self.assertEqual(config_push._safe_send(conn, "x"), "ok from timing")
        self.assertEqual(conn.calls, ["send_command", "send_command_timing"])

    def test_returns_an_error_string_rather_than_raising(self) -> None:
        # The property that matters: a command list is executed in order, and an exception here
        # would leave the firewall carrying half of it with nothing recorded about the rest.
        conn = self._Conn(first=RuntimeError("a"), timing=RuntimeError("b"))
        out = config_push._safe_send(conn, "x")
        self.assertIsInstance(out, str)
        self.assertIn("[error]", out)
        self.assertIn("RuntimeError", out, "the error text should name what went wrong")


class UnifiedDiffTests(unittest.TestCase):
    """The diff a push reports is computed on normalised text."""

    def test_identical_configs_produce_no_diff(self) -> None:
        text = "config system global\n    set hostname fgt\nend\n"
        self.assertEqual(config_push._unified_diff(text, text, "fgt", "fortinet"), "")

    def test_a_real_change_shows_up_with_both_sides(self) -> None:
        before = "config system global\n    set hostname old\nend\n"
        after = "config system global\n    set hostname new\nend\n"
        diff = config_push._unified_diff(before, after, "fgt", "fortinet")

        self.assertIn("-    set hostname old", diff)
        self.assertIn("+    set hostname new", diff)

    def test_noise_the_normaliser_masks_does_not_read_as_a_change(self) -> None:
        # Whatever device_profiles masks for this platform — password hashes, timestamps — must be
        # equal on both sides after normalisation, or every backup would look like a change and the
        # signal Config Drift depends on would be buried.
        import device_profiles

        before = "config system admin\n    set password ENC AAAAAAAA\nend\n"
        after = "config system admin\n    set password ENC BBBBBBBB\nend\n"
        if device_profiles.normalize_config(before, "fortinet") != device_profiles.normalize_config(after, "fortinet"):
            self.skipTest("this platform's normaliser does not mask password hashes")

        self.assertEqual(config_push._unified_diff(before, after, "fgt", "fortinet"), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)


class SafeFilename(unittest.TestCase):
    """A device NAME becomes a filename, and a name is typed by a person.

    Before this, ``save()`` interpolated the name straight into a path, so naming a firewall
    ``../../app/x`` wrote a file outside the backup directory with the worker's rights — and the
    content is whatever the "device" answered with.
    """

    def test_a_traversal_is_reduced_to_one_component(self):
        for name in ["../../etc/cron.d/x", "..", "../..", "/etc/passwd", "a/b/c"]:
            got = backup_fortigate.safe_filename(name)
            self.assertNotIn("/", got, f"{name!r} kept a separator: {got!r}")
            self.assertNotIn("\\", got, f"{name!r} kept a separator: {got!r}")
            self.assertNotIn("..", got, f"{name!r} can still climb: {got!r}")

    def test_a_windows_separator_is_a_separator_too(self):
        self.assertNotIn(chr(92), backup_fortigate.safe_filename(".." + chr(92) + ".." + chr(92) + "x"))

    def test_an_empty_or_dot_name_still_produces_a_filename(self):
        for name in ["", "   ", ".", "..", " . . "]:
            self.assertTrue(backup_fortigate.safe_filename(name),
                            f"{name!r} produced an empty filename")

    def test_a_dotfile_cannot_be_written(self):
        self.assertFalse(backup_fortigate.safe_filename(".git").startswith("."))

    def test_ordinary_names_are_left_alone(self):
        for name in ["lab-80E", "lab 80E", "FGT_Branch.01"]:
            self.assertEqual(backup_fortigate.safe_filename(name), name)

    def test_thai_names_survive(self):
        """Devices here are named in Thai as often as in English. Mapping those to "_" would give
        two firewalls one filename, and the second backup would overwrite the first."""
        for name in ["ไฟร์วอลล์-หลัก",
                     "สาขา 1"]:
            self.assertEqual(backup_fortigate.safe_filename(name), name)

    def test_the_name_is_bounded(self):
        self.assertLessEqual(len(backup_fortigate.safe_filename("a" * 500)), 80)
