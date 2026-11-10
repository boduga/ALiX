"""GE-04 read-only kernel corroboration for a pre-existing fixed systemd unit.

This is deliberately NOT a source of initial custody. All expected identities
come from an externally supplied original sealed receipt; the provider cannot
create or adopt units, mint intent, launch children or authorize an ACK.
"""
import os
import re
import select
import stat
import sys
from types import MappingProxyType

from systemd_unit_observer import UNIT, observe_fixed_systemd_unit

ROOT = "/sys/fs/cgroup"
PATH = ROOT + "/system.slice/" + UNIT
U64 = (1 << 64) - 1


def _read_fixed(path, cap):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Unexpected kernel evidence type")
        raw = bytearray()
        while len(raw) <= cap:
            chunk = os.read(fd, min(4096, cap + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        if len(raw) > cap or not raw or not raw.endswith(b"\n"):
            raise ValueError("Incomplete kernel evidence")
        return bytes(raw)
    finally:
        os.close(fd)


def _stat_generation(raw, pid):
    if (type(raw) is not bytes or not 0 < len(raw) <= 16384
            or not raw.startswith(str(pid).encode() + b" (")):
        raise ValueError("Invalid keeper proc stat")
    split = raw.rfind(b") ")
    if split < 0:
        raise ValueError("Malformed kernel proc stat")
    fields = raw[split + 2:].strip(b"\n").split(b" ")
    if len(fields) < 20 or fields[0] not in (b"R", b"S", b"D", b"T"):
        raise ValueError("Keeper not in acceptable live state")
    if not re.fullmatch(rb"[1-9][0-9]*", fields[19]):
        raise ValueError("Invalid keeper generation")
    ticks = int(fields[19])
    if ticks > U64:
        raise ValueError("Keeper generation out of range")
    return fields[0].decode("ascii"), ticks


def _mount(raw):
    if type(raw) is not bytes or not 0 < len(raw) <= 1048576:
        raise ValueError("Unbounded keeper mountinfo")
    mounts = []
    for entry in raw.splitlines():
        if b" - " not in entry:
            raise ValueError("Malformed mountinfo separator")
        left, right = entry.split(b" - ", 1)
        before = left.split(b" ")
        after = right.split(b" ")
        if len(before) < 6 or len(after) < 3:
            raise ValueError("Malformed mountinfo")
        if after[0] == b"cgroup2":
            if (before[3:5] != [b"/", b"/sys/fs/cgroup"]
                    or not re.fullmatch(rb"[1-9][0-9]*", before[0])
                    or not re.fullmatch(rb"[0-9]+:[0-9]+", before[2])):
                raise ValueError("Unexpected cgroup mount scope")
            mounts.append((int(before[0]), before[2].decode("ascii")))
    if len(mounts) != 1:
        raise ValueError("Missing or ambiguous keeper cgroup2 mount")
    return mounts[0]


def _scope(raw):
    if raw != ("0::/system.slice/" + UNIT + "\n").encode():
        raise ValueError("Keeper is not in exact exclusive unit cgroup")


def observe_fixed_unit_kernel(original, manager):
    """Observe real pidfd/procfs/mount/cgroup, compare to original binding.

    Neither supplied input is authenticated here. Source/expected reader
    custody and unit birth require an independently reviewed root bootstrap.
    """
    if sys.platform != "linux" or not hasattr(os, "pidfd_open"):
        raise RuntimeError("Linux pidfd required")
    if (type(original) is not dict or type(manager) is not dict
            or original.get("unit") != UNIT or manager.get("unit") != UNIT
            or manager.get("mainPid") != original.get("keeperPid")
            or manager.get("invocation") != original.get("invocation")
            or manager.get("controlGroup") != "/system.slice/" + UNIT):
        raise ValueError("Unbound expected unit and manager records")
    pid = original["keeperPid"]
    ticks = original["keeperTicks"]
    if (type(pid) is not int or not 2 <= pid <= 2**31 - 1
            or type(ticks) is not int or not 0 < ticks <= U64):
        raise ValueError("Invalid keeper identity")
    original_snapshot = original.copy()
    manager_snapshot = manager.copy()
    def proc_sample():
        state, current = _stat_generation(_read_fixed(f"/proc/{pid}/stat", 16384), pid)
        if current != ticks:
            raise ValueError("Keeper generation replaced")
        if _read_fixed(f"/proc/{pid}/cgroup", 4096) != (
                "0::/system.slice/" + UNIT + "\n").encode():
            raise ValueError("Keeper changed unit cgroup")
        return state
    state_before = proc_sample()
    pidfd = os.pidfd_open(pid, 0)
    try:
        poller = select.poll()
        poller.register(pidfd, select.POLLIN | select.POLLHUP | select.POLLERR)
        if poller.poll(0):
            raise ValueError("Keeper pidfd exited")
        mount = _mount(_read_fixed(f"/proc/{pid}/mountinfo", 1048576))
        if mount != (original.get("mountId"), original.get("mountDevice")):
            raise ValueError("Keeper cgroup mount replaced")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        ids = original.get("ancestry")
        if (type(ids) is not tuple or len(ids) != 3):
            raise ValueError("Original unit ancestry unavailable")
        opened = []
        try:
            opened.append(os.open(ROOT, flags))
            for part in ("system.slice", UNIT):
                opened.append(os.open(part, flags, dir_fd=opened[-1]))
            for fd, ident in zip(opened, ids):
                info = os.fstat(fd)
                if (type(ident) is not tuple or len(ident) != 2
                        or (info.st_dev, info.st_ino) != ident
                        or not stat.S_ISDIR(info.st_mode)):
                    raise ValueError("Original cgroup directory mismatch")
            filefd = os.open("cgroup.procs", os.O_RDONLY | os.O_NOFOLLOW
                             | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=opened[-1])
            try:
                members = bytearray()
                while len(members) <= 4096:
                    chunk = os.read(filefd, min(4096, 4097 - len(members)))
                    if not chunk:
                        break
                    members.extend(chunk)
                if len(members) > 4096 or members and not members.endswith(b"\n"):
                    raise ValueError("Unbounded cgroup membership")
                entries = bytes(members).splitlines()
                if (any(not re.fullmatch(rb"[1-9][0-9]{0,9}", x) for x in entries)
                        or len(entries) != len(set(entries))
                        or str(pid).encode() not in entries):
                    raise ValueError("Keeper absent from exact unit")
            finally:
                os.close(filefd)
            for fd, ident in zip(opened, ids):
                info = os.fstat(fd)
                if (info.st_dev, info.st_ino) != ident:
                    raise ValueError("Cgroup FD changed during observation")
        finally:
            for fd in reversed(opened):
                os.close(fd)
        if (proc_sample() not in ("R", "S", "D", "T") or poller.poll(0)
                or _mount(_read_fixed(f"/proc/{pid}/mountinfo", 1048576)) != mount
                or original != original_snapshot or manager != manager_snapshot):
            raise ValueError("Original/kernel generation changed during read")
        return MappingProxyType({
            "status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION",
            "pid": pid, "startticks": ticks, "mount": mount,
            "cgroup": "/system.slice/" + UNIT,
        })
    finally:
        os.close(pidfd)


def observe_manager_and_kernel(original):
    """Composite read-only observer; absence is fail-closed, no ACK."""
    first = observe_fixed_systemd_unit()
    manager = dict(first["properties"])
    # This deliberately cannot prove pre-birth original-record authenticity.
    observed = observe_fixed_unit_kernel(original, manager)
    second = observe_fixed_systemd_unit()
    if (dict(second["properties"]) != manager or second["owner"] != first["owner"]):
        raise ValueError("Manager changed across kernel observation")
    return MappingProxyType({
        "status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
        "managerOwner": first["owner"],
        "kernel": observed,
    })
