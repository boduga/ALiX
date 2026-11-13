"""MEDIUM-6: public observation entrypoints refuse root before any file I/O."""
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'native/ge04'))
import bounded_phase_observer
import protected_approval_observer
import unit_kernel_observer
import phase_controller
import isolated_phase_observer_worker
import unprivileged_observer


class RootRefusal(unittest.TestCase):
    def test_all_root_identity_dimensions_refuse(self):
        for name in ('getuid', 'geteuid', 'getgid', 'getegid'):
            with self.subTest(name=name), mock.patch.object(unprivileged_observer.os, name, return_value=0):
                with self.assertRaises(PermissionError):
                    unprivileged_observer.require_unprivileged()

    def test_public_entrypoints_refuse_before_io(self):
        entries = (
            lambda: bounded_phase_observer.observe_bounded(None, 0),
            lambda: protected_approval_observer.corroborate_existing_approval(None),
            lambda: unit_kernel_observer.observe_fixed_unit_kernel(None, None),
            lambda: unit_kernel_observer.observe_manager_and_kernel(None),
            lambda: phase_controller.ReadOnlyPhaseController(None),
        )
        with (mock.patch.object(unprivileged_observer.os, 'geteuid', return_value=0),
              mock.patch.object(unprivileged_observer.os, 'open', side_effect=AssertionError('unexpected file I/O')),
              mock.patch.object(bounded_phase_observer.subprocess, 'Popen', side_effect=AssertionError('unexpected subprocess'))):
            for entry in entries:
                with self.subTest(entry=entry), self.assertRaises(PermissionError):
                    entry()
            self.assertEqual(isolated_phase_observer_worker.main(), 77)

    def test_controller_accept_refuses_if_identity_changes(self):
        with mock.patch.object(phase_controller, '_exact_original', return_value={}):
            controller = phase_controller.ReadOnlyPhaseController({})
        with mock.patch.object(unprivileged_observer.os, 'geteuid', return_value=0):
            with self.assertRaises(PermissionError):
                controller.accept(b'', 0)
