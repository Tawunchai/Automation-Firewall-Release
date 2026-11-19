"""A stand-in for paramiko, shared by the test modules that need one.

``host_keys.py`` imports paramiko to read a device's SSH host key before any password is sent.
paramiko arrives with netmiko inside the worker container, but the test suite is run — in CI and
locally — on a machine where requirements.txt is deliberately NOT installed, so that the tests
exercise what a developer runs rather than what the image happens to contain. Everything the suite
imports therefore needs a paramiko module to exist.

Why this lives in its own file rather than beside the netmiko and redis stubs in test_worker.py:
``test_backup_and_push.py`` installs its own, different netmiko stub (a ConnectHandler that records
its arguments, where test_worker's throws), and it is imported FIRST by unittest discovery. Were it
to import test_worker to reach a shared stub, test_worker's module-level installation would run
first and win, and test_backup_and_push's cases would get the throwing handler. A module with no
test in it and no side effects at import can be shared by all of them safely.

This file is named so that `discover -p 'test_*.py'` does not pick it up as a test module.
"""

from __future__ import annotations

import sys
import types


def install_paramiko_stub() -> None:
    """Put a usable fake `paramiko` in sys.modules, unless a real one is already importable."""
    if "paramiko" in sys.modules:
        return
    try:  # the worker container has the real thing; leave it alone
        import paramiko  # noqa: F401 — presence is the whole check

        return
    except ImportError:
        pass

    stub = types.ModuleType("paramiko")

    class _HostKeys:
        """A working in-memory HostKeys, not a mock.

        What the tests check about it is the ENTRY NAME host_keys.py writes — a bare hostname on
        port 22 and ``[host]:port`` on any other — so `add` has to record what it was given and
        `save` has to produce a file that exists.
        """

        def __init__(self) -> None:
            self.entries: list[tuple[str, str, object]] = []

        def add(self, hostname: str, keytype: str, key: object) -> None:
            self.entries.append((hostname, keytype, key))

        def save(self, filename: str) -> None:
            with open(filename, "w", encoding="utf-8") as fh:
                for hostname, keytype, _key in self.entries:
                    fh.write(f"{hostname} {keytype} AAAA\n")

    def _no_transport(*_a, **_kw):
        # A test that reaches Transport is a test that was about to open a real socket.
        raise RuntimeError("test must not open a real SSH transport")

    stub.HostKeys = _HostKeys
    stub.PKey = type("PKey", (object,), {})
    stub.Transport = _no_transport
    sys.modules["paramiko"] = stub


def install_netmiko_stub() -> None:
    """Put a minimal fake `netmiko` in sys.modules, unless one is already there.

    Only for test modules that patch ``netmiko.ConnectHandler`` — ``mock.patch`` has to be able to
    import the module before it can replace an attribute on it. Deliberately does nothing when
    another test module has already installed its own: test_worker.py and test_backup_and_push.py
    each have one with behaviour their own cases depend on, and whichever unittest discovery
    imports first must keep it.
    """
    if "netmiko" in sys.modules:
        return
    try:
        import netmiko  # noqa: F401

        return
    except ImportError:
        pass

    stub = types.ModuleType("netmiko")

    def _no_session(*_a, **_kw):
        raise RuntimeError("test must not open a real SSH session")

    stub.ConnectHandler = _no_session

    exceptions = types.ModuleType("netmiko.exceptions")
    for name in ("NetmikoAuthenticationException", "NetmikoTimeoutException", "ReadTimeout"):
        setattr(exceptions, name, type(name, (Exception,), {}))
    stub.exceptions = exceptions

    sys.modules["netmiko"] = stub
    sys.modules["netmiko.exceptions"] = exceptions
