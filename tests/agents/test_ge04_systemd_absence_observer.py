"""GE-04 systemd absence observation must fail closed, never mutate units."""
import sys
import types
from pathlib import Path
from unittest import TestCase, mock, skipUnless

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
import systemd_absence_observer as observer


class SystemdAbsenceTests(TestCase):
    def fake_dbus(self, outcome=None, other="none"):
        class FakeDBusException(Exception):
            def __init__(self, name):
                super().__init__(name)
                self.name = name
            def get_dbus_name(self):
                return self.name

        class Bus:
            def __init__(self):
                self.calls = []
                self.owner = ":1.5"
            def get_name_owner(self, name):
                return self.owner
            def get_unix_user(self, name):
                return 0
            def get_object(self, owner, path, **kwargs):
                if owner != ":1.5" or kwargs.get("follow_name_owner_changes") is not False:
                    raise ValueError("Owner changed")
                return self
            def GetUnit(self, unit, timeout=None):
                self.calls.append(("GetUnit", unit))
                if outcome == "loaded":
                    return "/org/freedesktop/systemd1/unit/existing"
                if outcome == "ambiguous":
                    raise FakeDBusException("org.freedesktop.DBus.Error.Timeout")
                raise FakeDBusException(observer.NO_UNIT)
            def GetUnitFileState(self, unit, timeout=None):
                self.calls.append(("GetUnitFileState", unit))
                if outcome == "installed":
                    return "static"
                if outcome == "wrong-file-error":
                    raise FakeDBusException(observer.NO_UNIT)
                if outcome == "owner-change":
                    self.owner = ":1.6"
                raise FakeDBusException(observer.NO_UNIT_FILE)
        bus = Bus()
        fake = types.SimpleNamespace(
            SystemBus=lambda: bus,
            Interface=lambda obj, iface: obj,
            DBusException=FakeDBusException)
        return fake, bus

    def test_exact_negative_manager_and_unit_file_twice(self):
        fake, bus = self.fake_dbus()
        with mock.patch.dict(sys.modules, {"dbus": fake}):
            result = observer.probe_fixed_unit_absence()
        self.assertEqual(result["status"], "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION")
        self.assertEqual(result["managerOwner"], ":1.5")
        self.assertEqual([x[0] for x in bus.calls],
                         ["GetUnit", "GetUnitFileState"] * 2)
        with self.assertRaises(TypeError):
            result["unit"] = "wrong.service"

    def test_present_ambiguous_installed_or_owner_change_refuses(self):
        for state in ("loaded", "installed", "wrong-file-error",
                      "ambiguous", "owner-change"):
            fake, _ = self.fake_dbus(state)
            with self.subTest(state=state), mock.patch.dict(sys.modules, {"dbus": fake}):
                with self.assertRaises(ValueError):
                    observer.probe_fixed_unit_absence()

    def test_non_root_or_invalid_owner_refuses(self):
        fake, bus = self.fake_dbus()
        for altered in (lambda _: 1000, lambda _: -1):
            with mock.patch.dict(sys.modules, {"dbus": fake}):
                with mock.patch.object(bus, "get_unix_user", side_effect=altered):
                    with self.assertRaises(ValueError):
                        observer.probe_fixed_unit_absence()
        with mock.patch.dict(sys.modules, {"dbus": fake}):
            bus.owner = "org.freedesktop.systemd1"
            with self.assertRaises(ValueError):
                observer.probe_fixed_unit_absence()

    @skipUnless(sys.platform == "linux", "system bus on Linux")
    def test_live_observer_is_diagnostic_only(self):
        try:
            observed = observer.probe_fixed_unit_absence()
        except (ValueError, RuntimeError):
            return
        self.assertEqual(observed["status"], "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION")
