"""GE-04 JobRemoved live signal observer: fake GLib system bus + read-only host."""
import sys
import time
import types
import unittest
from pathlib import Path
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from systemd_job_signal_observer import observe_fixed_job_signal
from bootstrap_binding import UNIT

EXPECTED = {"unit": UNIT, "jobPath": "/org/freedesktop/systemd1/job/42",
            "managerOwner": ":1.5"}


class FakeMatch:
    def __init__(self, bus):
        self.bus = bus
    def remove(self):
        self.bus.removed += 1


class FakeBus:
    def __init__(self, event=None, *, changed=False, owner_uid=0,
                 sender=":1.5", subscribe_error=False):
        self.event = event
        self.sender = sender
        self.subscribe_error = subscribe_error
        self.changed = changed
        self.owner_uid = owner_uid
        self.listener = None
        self.subscribed = False
        self.unsubscribed = False
        self.removed = 0
        self.closed = False
        self.match_options = None
    def close(self):
        self.closed = True
    def get_name_owner(self, _):
        return ":1.6" if self.changed and self.subscribed else ":1.5"
    def get_unix_user(self, _):
        return self.owner_uid
    def add_signal_receiver(self, callback, **options):
        self.listener = callback
        self.match_options = options
        return FakeMatch(self)
    def get_object(self, name, path, **options):
        if name != ":1.5" or options != {"follow_name_owner_changes": False}:
            raise AssertionError("Unsafe dbus object binding")
        return self
    def Subscribe(self, timeout=None):
        if self.subscribe_error:
            raise RuntimeError("Subscribe access denied")
        self.subscribed = True
    def Unsubscribe(self, timeout=None):
        self.unsubscribed = True


class FakeLoop:
    def __init__(self, fake):
        self.fake = fake
    def run(self):
        if self.fake.bus.event is None:
            self.fake.timeout()
        else:
            self.fake.bus.listener(*self.fake.bus.event, sender=self.fake.bus.sender)
    def quit(self):
        self.fake.quit_called = True


class FakeGLib:
    def __init__(self, bus):
        self.bus = bus
        self.quit_called = False
        self.timeout = None
        self.removed = []
    def MainLoop(self):
        return FakeLoop(self)
    def timeout_add(self, ms, callback):
        if not 0 < ms <= 2000:
            raise AssertionError("Unbounded GLib loop")
        self.timeout = callback
        return 11
    def source_remove(self, key):
        self.removed.append(key)
        return True


class SignalObserverTests(unittest.TestCase):
    def run_fake(self, event, changed=False, uid=0, sender=":1.5",
                 subscribe_error=False):
        bus = FakeBus(event, changed=changed, owner_uid=uid, sender=sender,
                      subscribe_error=subscribe_error)
        glib = FakeGLib(bus)
        dbus = types.ModuleType("dbus")
        dbus.bus = types.SimpleNamespace(
            BUS_SYSTEM=1, BusConnection=lambda bus_type, **kw: bus)
        dbus.Interface = lambda obj, iface: obj
        loop_mod = types.ModuleType("dbus.mainloop")
        glib_mod = types.ModuleType("dbus.mainloop.glib")
        glib_mod.DBusGMainLoop = lambda **kw: object()
        gi = types.ModuleType("gi")
        repository = types.ModuleType("gi.repository")
        repository.GLib = glib
        gi.repository = repository
        patches = {"dbus": dbus, "dbus.mainloop": loop_mod,
                   "dbus.mainloop.glib": glib_mod,
                   "gi": gi, "gi.repository": repository}
        with mock.patch.dict(sys.modules, patches):
            try:
                result = observe_fixed_job_signal(EXPECTED, window_seconds=0.25)
                return result, bus, glib
            except Exception as error:
                return error, bus, glib

    def test_exact_job_signal_is_unqualified_and_receiver_cleaned(self):
        result, bus, glib = self.run_fake((42, EXPECTED["jobPath"], UNIT, "done"))
        self.assertEqual(result["status"], "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL")
        self.assertEqual(result["jobPath"], EXPECTED["jobPath"])
        self.assertEqual(bus.removed, 1)
        self.assertTrue(bus.closed)
        self.assertTrue(bus.subscribed and bus.unsubscribed)
        self.assertEqual(glib.removed, [11])
        self.assertEqual(bus.match_options["bus_name"], ":1.5")
        self.assertEqual(bus.match_options["sender_keyword"], "sender")

    def test_real_dbus_unsigned_job_id_normalized_to_builtin_int(self):
        try:
            import dbus
        except ImportError:
            self.skipTest("python-dbus unavailable")
        result, bus, _ = self.run_fake((
            dbus.UInt32(42), EXPECTED["jobPath"], UNIT, "done"))
        self.assertEqual(result["status"], "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL")
        self.assertEqual(bus.removed, 1)

    def test_wrong_job_id_path_result_and_sender_are_refused(self):
        for candidate in ((43, EXPECTED["jobPath"], UNIT, "done"),
                          (42, "/org/freedesktop/systemd1/job/43", UNIT, "done"),
                          (42, EXPECTED["jobPath"], UNIT, "failed"),
                          ("42", EXPECTED["jobPath"], UNIT, "done"),
                          (True, EXPECTED["jobPath"], UNIT, "done")):
            with self.subTest(candidate=candidate):
                result, bus, _ = self.run_fake(candidate)
                self.assertIsInstance(result, ValueError)
                self.assertEqual(bus.removed, 1)

    def test_wrong_sender_is_refused(self):
        result, bus, _ = self.run_fake(
            (42, EXPECTED["jobPath"], UNIT, "done"), sender=":1.6")
        self.assertIsInstance(result, ValueError)
        self.assertTrue(bus.unsubscribed)

    def test_silent_timeout_quarantines_and_cleans_listener(self):
        result, bus, glib = self.run_fake(None)
        self.assertIsInstance(result, ValueError)
        self.assertEqual(bus.removed, 1)
        self.assertTrue(bus.unsubscribed)
        self.assertEqual(glib.removed, [])

    def test_failed_subscribe_closes_private_bus_and_match(self):
        error, bus, _ = self.run_fake(None, subscribe_error=True)
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(str(error), "Subscribe access denied")
        self.assertEqual(bus.removed, 1)
        self.assertTrue(bus.closed)
        self.assertFalse(bus.subscribed)

    def test_manager_uid_and_owner_change_refuse(self):
        error, bus, _ = self.run_fake((42, EXPECTED["jobPath"], UNIT, "done"),
                                      changed=True)
        self.assertIsInstance(error, ValueError)
        self.assertEqual(bus.removed, 1)
        error, bus, _ = self.run_fake(None, uid=1000)
        self.assertIsInstance(error, ValueError)
        self.assertIsNone(bus.listener)
        self.assertTrue(bus.closed)

    def test_window_is_short_and_never_creates_service(self):
        with self.assertRaises(ValueError):
            observe_fixed_job_signal(EXPECTED, window_seconds=15)
        with self.assertRaises(ValueError):
            observe_fixed_job_signal(EXPECTED, window_seconds=True)
        with self.assertRaises(ValueError):
            observe_fixed_job_signal(EXPECTED, window_seconds=0)

    @unittest.skipUnless(sys.platform == "linux", "system bus only on Linux")
    def test_live_quiet_unit_never_creates_service(self):
        try:
            import dbus
            owner = str(dbus.SystemBus().get_name_owner("org.freedesktop.systemd1"))
        except Exception as exc:
            if exc.__class__.__module__.startswith("dbus") or isinstance(exc, ImportError):
                self.skipTest("System bus unavailable to unprivileged test")
            raise
        expected = {**EXPECTED, "managerOwner": owner}
        try:
            with self.assertRaisesRegex(ValueError, "No exact, trustworthy live job observation"):
                observe_fixed_job_signal(expected, window_seconds=.1)
        except dbus.exceptions.DBusException as exc:
            if exc.get_dbus_name() in (
                    "org.freedesktop.DBus.Error.AccessDenied",
                    "org.freedesktop.DBus.Error.NoServer",
                    "org.freedesktop.DBus.Error.ServiceUnknown",
                    "org.freedesktop.DBus.Error.FileNotFound"):
                self.skipTest("System bus subscription unavailable: " + exc.get_dbus_name())
            raise
        except RuntimeError as exc:
            if str(exc) == "dbus-python and GLib unavailable":
                self.skipTest("GLib/dbus bindings unavailable")
            raise
