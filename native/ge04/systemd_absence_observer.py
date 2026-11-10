"""GE-04 read-only fixed-unit absence probe over systemd's system D-Bus.

Observing two NoSuchUnit responses cannot reserve the unit or authorize
creation. Treat this as an UNQUALIFIED prebirth diagnostic only.
"""
import re
import sys
from types import MappingProxyType

from systemd_unit_observer import MANAGER_IFACE, MANAGER_PATH, SERVICE, UNIT

NO_UNIT = "org.freedesktop.systemd1.NoSuchUnit"
NO_UNIT_FILE = "org.freedesktop.DBus.Error.FileNotFound"


def _absence_response(method, name, exception):
    """Only the exact systemd negative result is acceptable."""
    allowed = NO_UNIT if method == "GetUnit" else NO_UNIT_FILE
    return type(name) is str and name == allowed and isinstance(exception, BaseException)


def probe_fixed_unit_absence():
    """Read manager twice; never create, start, enable or register a unit.

    Returns unqualified absence of the *currently loaded* unit and unit
    file. No caller can use this as a linearizable no-adoption predicate.
    """
    if sys.platform != "linux":
        raise RuntimeError("Linux systemd manager required")
    try:
        import dbus
    except ImportError as exc:
        raise RuntimeError("python-dbus unavailable") from exc
    try:
        bus = dbus.SystemBus()
        owner = str(bus.get_name_owner(SERVICE))
        if (not re.fullmatch(r":[0-9]+\.[0-9]+", owner)
                or int(bus.get_unix_user(owner)) != 0):
            raise ValueError("Untrusted or changed systemd owner")
        manager = dbus.Interface(
            bus.get_object(owner, MANAGER_PATH, follow_name_owner_changes=False),
            MANAGER_IFACE)
        for _ in range(2):
            for method in ("GetUnit", "GetUnitFileState"):
                try:
                    getattr(manager, method)(UNIT, timeout=2)
                except dbus.DBusException as exc:
                    if not _absence_response(method, exc.get_dbus_name(), exc):
                        raise ValueError("Ambiguous systemd absence response") from exc
                else:
                    raise ValueError("Fixed systemd unit or unit file exists")
            if (str(bus.get_name_owner(SERVICE)) != owner
                    or int(bus.get_unix_user(owner)) != 0):
                raise ValueError("Systemd manager owner changed")
        return MappingProxyType({
            "status": "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION",
            "unit": UNIT,
            "managerOwner": owner,
        })
    except (ValueError, RuntimeError):
        raise
    except Exception as exc:
        raise ValueError("Systemd absence not established") from exc
