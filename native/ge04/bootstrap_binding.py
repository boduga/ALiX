"""GE-04 sealed bootstrap-binding *transport contract* — SECURITY HOLD.

Read-only receipt of a bounded immutable Linux memfd. Seals prove stability,
not who created it or whether systemd/kernel claims are true. This module
has no privileged caller, no root bootstrap, no ACK, and no production use.
"""
try:
    import fcntl
except ImportError:
    fcntl = None
import json
import os
import re
import stat
import sys
from types import MappingProxyType

LIMIT = 4096
_SEAL_NAMES = ("F_SEAL_WRITE", "F_SEAL_SHRINK", "F_SEAL_GROW", "F_SEAL_SEAL", "F_GET_SEALS")
SUPPORTED = (sys.platform == "linux" and fcntl is not None
             and all(hasattr(fcntl, name) for name in _SEAL_NAMES))
SEALS = (sum(getattr(fcntl, name) for name in _SEAL_NAMES[:-1])
         if SUPPORTED else 0)
FIELDS = frozenset((
    "schemaVersion", "unit", "invocation", "keeperPid", "keeperTicks",
    "mountId", "mountDevice", "mountRoot", "ancestry", "attempt",
    "nonce", "sourceSha256", "controllerSha256",
))
UNIT = "ge04-r1b2-view-qualification.service"


def _unique(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate bootstrap evidence key")
        result[name] = value
    return result


def parse_bootstrap_binding(raw):
    """Canonical, closed format. Every claim is UNTRUSTED until verified."""
    if type(raw) is not bytes or not 0 < len(raw) <= LIMIT or not raw.endswith(b"\n"):
        raise ValueError("Unbounded bootstrap evidence")
    try:
        data = json.loads(raw.decode("ascii"), object_pairs_hook=_unique,
                          parse_float=lambda _: (_ for _ in ()).throw(ValueError("float")),
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError("constant")))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Malformed bootstrap evidence") from exc
    if type(data) is not dict or frozenset(data) != FIELDS:
        raise ValueError("Incomplete bootstrap evidence")
    if (type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1
            or data["unit"] != UNIT
            or type(data["invocation"]) is not str
            or re.fullmatch(r"[0-9a-f]{32}", data["invocation"]) is None
            or type(data["mountRoot"]) is not str or data["mountRoot"] != "/"
            or type(data["mountDevice"]) is not str
            or re.fullmatch(r"[0-9]+:[0-9]+", data["mountDevice"]) is None
            or type(data["nonce"]) is not str
            or re.fullmatch(r"[0-9a-f]{64}", data["nonce"]) is None):
        raise ValueError("Malformed bootstrap identity claims")
    for key in ("keeperPid", "keeperTicks", "mountId", "attempt"):
        value = data[key]
        if type(value) is not int or not 0 < value < 2**63:
            raise ValueError("Malformed bootstrap counter: " + key)
    if not 2 <= data["keeperPid"] <= 2**31 - 1:
        raise ValueError("Invalid bootstrap keeper PID")
    if (type(data["ancestry"]) is not list or len(data["ancestry"]) != 3
            or any(type(pair) is not list or len(pair) != 2
                   or any(type(n) is not int or not 0 < n < 2**63 for n in pair)
                   for pair in data["ancestry"])):
        raise ValueError("Malformed bootstrap cgroup ancestry")
    for key in ("sourceSha256", "controllerSha256"):
        if type(data[key]) is not str or re.fullmatch(r"[0-9a-f]{64}", data[key]) is None:
            raise ValueError("Malformed staged source digest")
    # Canonical encoding prevents different byte strings for the same claims.
    expected = (json.dumps(data, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=True) + "\n").encode("ascii")
    if raw != expected:
        raise ValueError("Noncanonical bootstrap evidence")
    data["ancestry"] = tuple(tuple(pair) for pair in data["ancestry"])
    return MappingProxyType(data)


def read_sealed_bootstrap_binding(fd, expected_uid=0, expected_gid=0,
                                  expected_inode=None):
    """Read sealed memfd without changing its offset.

    Expected UID, GID and inode MUST come from a separately trusted
    publisher handoff. Checking these alone is NOT origin authentication.
    """
    if not SUPPORTED:
        raise RuntimeError("Linux sealed memfd is required")
    if (type(fd) is not int or fd < 0 or type(expected_uid) is not int
            or not 0 <= expected_uid < 2**32 or type(expected_gid) is not int
            or not 0 <= expected_gid < 2**32):
        raise ValueError("Invalid bootstrap descriptor request")
    if expected_inode is not None and (
        type(expected_inode) is not tuple or len(expected_inode) != 2
        or any(type(x) is not int or x <= 0 for x in expected_inode)
    ):
        raise ValueError("Invalid original descriptor identity")
    before = os.fstat(fd)
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != expected_uid
            or before.st_gid != expected_gid or before.st_nlink != 0
            or not 0 < before.st_size <= LIMIT
            or (expected_inode is not None and
                (before.st_dev, before.st_ino) != expected_inode)):
        raise ValueError("Bootstrap descriptor custody mismatch")
    if fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS:
        raise ValueError("Bootstrap descriptor not fully sealed")
    raw = os.pread(fd, before.st_size + 1, 0)
    record = parse_bootstrap_binding(raw)
    after = os.fstat(fd)
    if ((before.st_dev, before.st_ino, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size) !=
        (after.st_dev, after.st_ino, after.st_uid, after.st_gid,
         after.st_nlink, after.st_size)
            or fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS):
        raise ValueError("Bootstrap descriptor changed during read")
    return MappingProxyType({"status": "UNQUALIFIED_SEALED_BOOTSTRAP",
                             "record": record,
                             "descriptorIdentity": (before.st_dev, before.st_ino)})
