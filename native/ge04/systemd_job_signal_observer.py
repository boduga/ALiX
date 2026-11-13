"""GE-04 bounded read-only systemd JobRemoved signal observer.

This diagnostic uses the actual system bus when called normally; it does not
create a unit or authenticate an original issuer/creation transaction.
All results remain UNQUALIFIED. No privileged caller or ACK.
"""
import re
import os
import sys
import time
from types import MappingProxyType

from systemd_unit_observer import (
    SERVICE, MANAGER_IFACE, MANAGER_PATH, UNIT,
)
from systemd_job_event_contract import JobEventWindow

SIGNAL = "JobRemoved"
MAX_WINDOW_SECONDS = 2.0
_OWNER = re.compile(r":[0-9]+\.[0-9]+")


def observe_fixed_job_signal(expected, *, window_seconds=1.0):
    """Subscribe, listen, and remove listener under a short bounded GLib loop.

    Does not create/modify units; registering for notifications is the only
    manager interaction besides querying its unique owner. The expected job
    identity is supplied by caller and has NO protected provenance.

    NOTE: the GLib loop is time-limited, but synchronously establishing the
    bus/Subscribe may extend wall-clock duration. Never use for authority.
    """
    if (sys.platform != "linux" or os.geteuid() == 0
            or type(window_seconds) not in (int, float)
            or not 0 < window_seconds <= MAX_WINDOW_SECONDS):
        raise ValueError("Unsupported read-only job observation window")
    window = JobEventWindow(expected)
    try:
        import dbus
        from dbus.mainloop.glib import DBusGMainLoop
        from gi.repository import GLib
    except ImportError as exc:
        raise RuntimeError("dbus-python and GLib unavailable") from exc

    # dbus.SystemBus caches a connection that may lack GLib integration.
    # BusConnection creates a private connection with its own main loop.
    bus = dbus.bus.BusConnection(
        dbus.bus.BUS_SYSTEM, mainloop=DBusGMainLoop(set_as_default=False))
    try:
        owner = str(bus.get_name_owner(SERVICE))
        if (not _OWNER.fullmatch(owner)
                or int(bus.get_unix_user(owner)) != 0
                or owner != expected["managerOwner"]):
            raise ValueError("Untrusted systemd manager or original owner changed")

        loop = GLib.MainLoop()
        recorded = None
        failure = None
        match = None
        subscribed = False
        deadline = time.monotonic() + window_seconds
        timed_out = False

        def on_signal(job_id, job_path, unit, result, sender=None):
            nonlocal recorded, failure
            if str(unit) != UNIT:
                return
            try:
                if (time.monotonic() >= deadline
                        or str(bus.get_name_owner(SERVICE)) != owner
                        or int(bus.get_unix_user(owner)) != 0):
                    raise ValueError("Expired or changed manager before event")
                if not isinstance(job_id, int) or isinstance(job_id, bool):
                    raise ValueError("Malformed manager job ID type")
                event = {
                    "sender": str(sender), "jobId": int(job_id),
                    "jobPath": str(job_path), "unit": str(unit),
                    "result": str(result),
                }
                # An unexpected job for our fixed unit is a terminal mismatch;
                # do not silently accept a later job with the expected name.
                recorded = window.accept(event)
            except Exception as exc:
                window.quarantine()
                failure = exc
            finally:
                loop.quit()

        def on_timeout():
            nonlocal timed_out
            timed_out = True
            window.quarantine()
            loop.quit()
            return False

        timeout_source = None
        try:
            # Subscription precedes our observation interval. However, it is
            # NOT bound to any exclusive StartTransientUnit request here.
            match = bus.add_signal_receiver(
                on_signal, signal_name=SIGNAL, dbus_interface=MANAGER_IFACE,
                bus_name=owner, path=MANAGER_PATH, sender_keyword="sender")
            manager = dbus.Interface(
                bus.get_object(owner, MANAGER_PATH,
                               follow_name_owner_changes=False), MANAGER_IFACE)
            manager.Subscribe(timeout=1)
            subscribed = True
            if str(bus.get_name_owner(SERVICE)) != owner:
                raise ValueError("Manager changed before event loop")
            milliseconds = max(1, int((deadline - time.monotonic()) * 1000))
            if time.monotonic() >= deadline:
                raise TimeoutError("Signal window exhausted before listening")
            if recorded is None and failure is None:
                timeout_source = GLib.timeout_add(milliseconds, on_timeout)
                loop.run()
            if timed_out or failure is not None or recorded is None:
                raise ValueError("No exact, trustworthy live job observation") from failure
            if (time.monotonic() >= deadline
                    or str(bus.get_name_owner(SERVICE)) != owner
                    or int(bus.get_unix_user(owner)) != 0):
                raise ValueError("Systemd manager changed after signal")
            return MappingProxyType({
                "status": "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL",
                "managerOwner": owner,
                "jobPath": recorded["jobPath"],
                "unit": UNIT,
                "result": recorded["result"],
            })
        finally:
            window.quarantine()
            if timeout_source is not None and not timed_out:
                GLib.source_remove(timeout_source)
            if match is not None:
                match.remove()
            if subscribed:
                try:
                    manager.Unsubscribe(timeout=1)
                except Exception:
                    # Cannot establish complete cancellation/manager state.
                    # No positive result should be treated as authoritative.
                    pass

    finally:
        bus.close()
