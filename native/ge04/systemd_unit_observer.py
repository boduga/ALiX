"""GE-04 qualification-only systemd D-Bus observation; no unit mutation.

Queries the fixed unit by authenticated system-bus owner, constrains root
sender UID, reads Unit/Service property dictionaries and verifies stable
unique bus owner and unit object path. No worker/controller authority.
"""
import re
import sys
from types import MappingProxyType

UNIT = "ge04-r1b2-view-qualification.service"
SERVICE = "org.freedesktop.systemd1"
MANAGER_PATH = "/org/freedesktop/systemd1"
FIXED_UNIT_PATH = MANAGER_PATH + "/unit/ge04_2dr1b2_2dview_2dqualification_2eservice"
MANAGER_IFACE = "org.freedesktop.systemd1.Manager"
UNIT_IFACE = "org.freedesktop.systemd1.Unit"
SERVICE_IFACE = "org.freedesktop.systemd1.Service"
PROPERTIES_IFACE = "org.freedesktop.DBus.Properties"


def _unit_details(unit, service, path):
    """Strictly translate manager-returned values, not self-invented fields."""
    if type(unit) is not dict or type(service) is not dict:
        raise ValueError("Untrusted systemd property map")
    for key in ("Id", "LoadState", "ActiveState", "SubState",
                "InvocationID"):
        if key not in unit:
            raise ValueError("Missing systemd Unit property: " + key)
    for key in ("MainPID", "NRestarts", "ControlGroup"):
        if key not in service:
            raise ValueError("Missing systemd Service property: " + key)
    invocation = unit["InvocationID"]
    if type(invocation) in (bytes, bytearray):
        token = bytes(invocation).hex()
    elif type(invocation) is str:
        token = invocation
    else:
        try:
            token = bytes(invocation).hex()
        except (TypeError, ValueError) as exc:
            raise ValueError("Malformed manager invocation") from exc
    if (unit["Id"] != UNIT or unit["LoadState"] != "loaded"
            or unit["ActiveState"] != "active"
            or unit["SubState"] != "running"
            or service["ControlGroup"] != "/system.slice/" + UNIT
            or re.fullmatch("[0-9a-f]{32}", token) is None
            or type(service["MainPID"]) is not int
            or not 2 <= service["MainPID"] <= 2**31 - 1
            or type(service["NRestarts"]) is not int
            or service["NRestarts"] != 0
            or type(path) is not str or path != FIXED_UNIT_PATH):
        raise ValueError("Unbound, restarted or unsupported fixed systemd unit")
    return MappingProxyType({
        "unit": UNIT, "invocation": token, "mainPid": service["MainPID"],
        "controlGroup": service["ControlGroup"], "activeState": unit["ActiveState"],
        "subState": unit["SubState"], "restartCount": service["NRestarts"],
        "objectPath": path,
    })


def observe_fixed_systemd_unit():
    """Actual system D-Bus read: diagnostic only, fail closed on absence.

    Bus owner identity is pinned per query and root UID corroborated. This
    is not proof of original unit birth, keeper generation, or attempt.
    """
    if sys.platform != "linux":
        raise RuntimeError("Linux systemd observer only")
    try:
        import dbus
    except ImportError as exc:
        raise RuntimeError("python-dbus unavailable") from exc
    try:
        bus = dbus.SystemBus()
        owner = str(bus.get_name_owner(SERVICE))
        if (not re.fullmatch(r":[0-9]+\.[0-9]+", owner)
                or int(bus.get_unix_user(SERVICE)) != 0):
            raise ValueError("Untrusted systemd bus owner")
        manager = dbus.Interface(
            bus.get_object(owner, MANAGER_PATH, follow_name_owner_changes=False),
            MANAGER_IFACE)
        path = str(manager.GetUnit(UNIT, timeout=2))
        properties = dbus.Interface(
            bus.get_object(owner, path, follow_name_owner_changes=False),
            PROPERTIES_IFACE)
        def sample():
            raw_unit = dict(properties.GetAll(UNIT_IFACE, timeout=2))
            raw_service = dict(properties.GetAll(SERVICE_IFACE, timeout=2))
            unit = {k: (bytes(v) if k == "InvocationID" else str(v))
                    for k, v in raw_unit.items() if k in (
                        "Id", "LoadState", "ActiveState", "SubState",
                        "InvocationID")}
            service = {k: (int(v) if k != "ControlGroup" and type(v) in (dbus.UInt32, dbus.UInt64)
                           else str(v) if k == "ControlGroup" else v) for k, v in raw_service.items()
                       if k in ("MainPID", "NRestarts", "ControlGroup")}
            return _unit_details(unit, service, path)
        evidence = sample()
        if (str(bus.get_name_owner(SERVICE)) != owner
                or int(bus.get_unix_user(owner)) != 0
                or str(manager.GetUnit(UNIT, timeout=2)) != path
                or dict(sample()) != dict(evidence)):
            raise ValueError("systemd manager identity or properties changed")
        return MappingProxyType({
            "status": "UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION",
            "owner": owner, "properties": evidence,
        })
    except dbus.exceptions.DBusException as exc:
        raise ValueError("Cannot authenticate fixed loaded systemd unit") from exc
