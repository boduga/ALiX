"""GE-04 publisher contract: fixture-only reconciliation, no privileged tests."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "native/ge04"
SUPPORTED = (sys.platform == "linux" and hasattr(os, "memfd_create"))
publisher = binding = None
if SUPPORTED:
    sys.path.insert(0, str(SOURCE))
    import bootstrap_binding as binding
    import bootstrap_publisher as publisher


def records():
    original = {
        "unit": "ge04-r1b2-view-qualification.service",
        "invocation": "a" * 32,
        "keeperPid": 101, "keeperTicks": 123456,
        "mountId": 39, "mountDevice": "0:29", "mountRoot": "/",
        "ancestry": ((1, 15), (1, 16), (1, 17)),
        "attempt": 1, "nonce": "b" * 64,
        "sourceSha256": "c" * 64, "controllerSha256": "d" * 64,
    }
    manager = {
        "unit": original["unit"], "invocation": original["invocation"],
        "mainPid": 101,
        "controlGroup": "/system.slice/" + original["unit"],
        "activeState": "active", "subState": "running",
        "restartCount": 0, "startTicks": 123456,
    }
    kernel = {
        "keeperPid": 101, "keeperTicks": 123456, "mountId": 39,
        "mountDevice": "0:29", "mountRoot": "/",
        "ancestry": original["ancestry"],
        "scope": manager["controlGroup"],
        "keeperState": "S", "unitPresent": True,
    }
    return original, manager, kernel


@unittest.skipUnless(SUPPORTED, "Linux sealed fixture only")
class BootstrapPublisherTests(unittest.TestCase):
    def test_root_publisher_unconditionally_refused(self):
        with self.assertRaises(PermissionError):
            publisher.publish_root_bootstrap()

    def test_sealed_unprivileged_reconciliation(self):
        original, manager, kernel = records()
        result = publisher.validate_prepublished_evidence(original, manager, kernel)
        self.assertEqual(result["status"], "UNQUALIFIED_PREBIRTH_RECONCILIATION")
        self.assertEqual(result["record"]["keeperPid"], 101)
        with self.assertRaises(TypeError):
            result["record"]["keeperPid"] = 102
        if os.geteuid() == 0:
            with self.assertRaises(PermissionError):
                publisher.prepare_unprivileged_fixture_fd(
                    original, lambda: manager, lambda: kernel)
            return
        fd = publisher.prepare_unprivileged_fixture_fd(
            original, lambda: manager.copy(), lambda: kernel.copy())
        try:
            received = binding.read_sealed_bootstrap_binding(
                fd, expected_uid=os.getuid(), expected_gid=os.getgid())
            self.assertEqual(received["record"], result["record"])
        finally:
            os.close(fd)

    def test_refuse_every_disputed_systemd_and_kernel_field(self):
        original, manager, kernel = records()
        bad_manager = {
            "unit": "other.service", "invocation": "f" * 32,
            "mainPid": 102, "controlGroup": "/system.slice/wrong",
            "activeState": "failed", "subState": "dead",
            "restartCount": 1, "startTicks": 123457,
        }
        bad_kernel = {
            "keeperPid": 102, "keeperTicks": 123457,
            "mountId": 40, "mountDevice": "0:30", "mountRoot": "/nested",
            "ancestry": ((1, 15), (1, 16), (1, 18)),
            "scope": "/system.slice/wrong",
            "keeperState": "Z", "unitPresent": False,
        }
        for key, changed in bad_manager.items():
            with self.subTest(kind="manager", key=key), self.assertRaises(ValueError):
                publisher.validate_prepublished_evidence(
                    original, {**manager, key: changed}, kernel)
        for key, changed in bad_kernel.items():
            with self.subTest(kind="kernel", key=key), self.assertRaises(ValueError):
                publisher.validate_prepublished_evidence(
                    original, manager, {**kernel, key: changed})

    def test_refuse_invalid_original_fences_and_fields(self):
        original, manager, kernel = records()
        wrong = (
            {"attempt": 0}, {"attempt": True}, {"nonce": "A" * 64},
            {"sourceSha256": "z" * 64}, {"invocation": "a"},
            {"keeperPid": 0}, {"mountDevice": "wrong"},
            {"ancestry": ((1, 2),)},
            {"unknownField": "x"},
        )
        for replacement in wrong:
            with self.subTest(changed=replacement), self.assertRaises(ValueError):
                publisher.validate_prepublished_evidence(
                    {**original, **replacement}, manager, kernel)
        for changed in ({**manager, "unexpected": True},
                        {**kernel, "unknown": True}):
            with self.assertRaises(ValueError):
                if "mainPid" in changed:
                    publisher.validate_prepublished_evidence(original, changed, kernel)
                else:
                    publisher.validate_prepublished_evidence(original, manager, changed)

    def test_refuse_changed_manager_and_kernel_between_samples(self):
        original, manager, kernel = records()
        manager_reads = iter((manager, {**manager, "restartCount": 1}))
        kernel_reads = iter((kernel, kernel))
        if os.geteuid() == 0:
            with self.assertRaises(PermissionError):
                publisher.prepare_unprivileged_fixture_fd(
                    original, lambda: next(manager_reads), lambda: next(kernel_reads))
            return
        with self.assertRaises(ValueError):
            publisher.prepare_unprivileged_fixture_fd(
                original, lambda: next(manager_reads), lambda: next(kernel_reads))
        manager_reads = iter((manager, manager))
        kernel_reads = iter((kernel, {**kernel, "mountId": 40}))
        with self.assertRaises(ValueError):
            publisher.prepare_unprivileged_fixture_fd(
                original, lambda: next(manager_reads), lambda: next(kernel_reads))

    def test_root_eligibility_is_never_inferred_from_mocked_uid(self):
        original, manager, kernel = records()
        with mock.patch.object(publisher.os, "geteuid", return_value=0):
            with self.assertRaises(PermissionError):
                publisher.prepare_unprivileged_fixture_fd(
                    original, lambda: manager, lambda: kernel)
        with self.assertRaises(PermissionError):
            publisher.publish_root_bootstrap(original, manager, kernel)
