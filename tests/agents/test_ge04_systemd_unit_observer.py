"""Read-only GE-04 systemd bus observer: no service activation tests."""
import importlib.util
from pathlib import Path
import sys
import unittest

SRC = Path(__file__).resolve().parents[2] / "native/ge04/systemd_unit_observer.py"
spec = importlib.util.spec_from_file_location("ge04_systemd_unit_observer", SRC)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


def values():
    props = {
        "Id": observer.UNIT, "LoadState": "loaded",
        "ActiveState": "active", "SubState": "running",
        "InvocationID": bytes.fromhex("ab" * 16),
    }
    svc = {"MainPID": 128, "NRestarts": 0,
           "ControlGroup": "/system.slice/" + observer.UNIT}
    path = observer.MANAGER_PATH + "/unit/ge04_2dr1b2_2dview_2dqualification_2eservice"
    return props, svc, path


class SystemdUnitObserverTests(unittest.TestCase):
    def test_exact_properties_are_diagnostic_only(self):
        unit, svc, path = values()
        result = observer._unit_details(unit, svc, path)
        self.assertEqual(result["unit"], observer.UNIT)
        self.assertEqual(result["invocation"], "ab" * 16)
        self.assertEqual(result["mainPid"], 128)
        with self.assertRaises(TypeError):
            result["mainPid"] = 129

    def test_changed_manager_properties_fail_closed(self):
        unit, svc, path = values()
        wrong_unit = {
            "Id": "other.service", "LoadState": "masked",
            "ActiveState": "inactive", "SubState": "dead",
            "InvocationID": b"bad",
        }
        wrong_svc = {"MainPID": 0, "NRestarts": 1,
                     "ControlGroup": "/system.slice/wrong"}
        for key, bad in wrong_unit.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                observer._unit_details({**unit, key: bad}, svc, path)
        for key, bad in wrong_svc.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                observer._unit_details(unit, {**svc, key: bad}, path)
        for bad_path in ("/tmp/unit/xx", "/", path + "/extra", path + "-"):
            with self.subTest(path=bad_path), self.assertRaises(ValueError):
                observer._unit_details(unit, svc, bad_path)

    def test_missing_properties_and_wrong_types_fail(self):
        unit, svc, path = values()
        for key in unit:
            with self.subTest(key=key), self.assertRaises(ValueError):
                observer._unit_details({k: v for k, v in unit.items() if k != key}, svc, path)
        for key in svc:
            with self.subTest(key=key), self.assertRaises(ValueError):
                observer._unit_details(unit, {k: v for k, v in svc.items() if k != key}, path)
        for bad in (True, "128", -1, 2**35):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                observer._unit_details(unit, {**svc, "MainPID": bad}, path)

    def test_dbus_interface_correct_positive_and_changed_resample(self):
        import types
        from unittest import mock
        unit, service, path = values()
        class FakeBus:
            changed = False
            samples = 0
            def get_name_owner(self, name):
                return ":1.5"
            def get_unix_user(self, name):
                return 0
            def get_object(self, owner, object_path, **kwargs):
                if owner != ":1.5" or object_path not in (observer.MANAGER_PATH, path):
                    raise ValueError("Unexpected fake bus object")
                return self
            def GetUnit(self, name, timeout=None):
                return path
            def GetAll(self, interface, timeout=None):
                if interface == observer.UNIT_IFACE:
                    self.samples += 1
                    return unit.copy()
                if interface == observer.SERVICE_IFACE:
                    return {**service, "NRestarts": 1} if self.changed else service.copy()
                raise ValueError("Unexpected D-Bus interface")
        instance = FakeBus()
        fake = types.SimpleNamespace(
            SystemBus=lambda: instance,
            Interface=lambda obj, interface: obj,
            UInt32=type("UInt32", (int,), {}),
            UInt64=type("UInt64", (int,), {}),
            exceptions=types.SimpleNamespace(DBusException=Exception),
        )
        with mock.patch.dict(sys.modules, {"dbus": fake}):
            result = observer.observe_fixed_systemd_unit()
            self.assertEqual(result["status"],
                             "UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION")
            self.assertEqual(result["properties"]["controlGroup"],
                             service["ControlGroup"])
            self.assertEqual(instance.samples, 2)
            instance.samples = 0
            original = instance.GetAll
            def changing(interface, timeout=None):
                data = original(interface, timeout)
                if instance.samples > 1 and interface == observer.SERVICE_IFACE:
                    return {**service, "NRestarts": 1}
                return data
            instance.GetAll = changing
            with self.assertRaises(ValueError):
                observer.observe_fixed_systemd_unit()

    @unittest.skipUnless(sys.platform == "linux", "Only Linux has a system manager")
    def test_live_fixed_unit_never_creates_or_adopts(self):
        # The qualification unit must be absent on an ordinary host.
        # If present, it is still never adopted by this test.
        try:
            observed = observer.observe_fixed_systemd_unit()
        except (ValueError, RuntimeError):
            return
        self.assertEqual(observed["status"],
                         "UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION")
