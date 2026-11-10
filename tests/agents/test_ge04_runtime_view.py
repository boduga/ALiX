"""GE-04 runtime-view qualification: local contracts only (NOT root-ready).

The live observer/cleanup admission is intentionally unimplemented.  This module
must refuse privileged execution, including correctly staged root invocation,
until a separately reviewed live controller replaces this denial.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
CODE = Path("/run/ge04-view-code")
STAGE_DIRS = ("native", "native/ge04", "tests", "tests/agents", "bin")
STAGE_FILES = {
    "native/ge04/cgroup-runtime-view-qualification.c": 0o400,
    "tests/agents/test_ge04_runtime_view.py": 0o400,
    "bin/probe": 0o500,
    "manifest.json": 0o400,
}
STAGE = {"": ("directory", 0o700)}
STAGE.update({p: ("directory", 0o700) for p in STAGE_DIRS})
STAGE.update({p: ("regular", mode) for p, mode in STAGE_FILES.items()})
PHASES = frozenset(("INTENT", "PRE_NAMESPACE", "PINNED", "ENABLED",
                    "PRE_JOIN", "READY", "EMPTY", "DENIED"))
REASONS = frozenset(("COMPLETED", "RECOVERED", "EMPTY_SWEEP",
    "MOUNT_INJECTED", "ENABLE_EBADF", "INJECTION_FAILED", "PRECONDITION",
    "LOCK_DENIED", "LOCK_ERROR", "EXISTING_STATE", "INTENT_DENIED",
    "BINDING_DENIED", "RESOURCE_DENIED", "CLONE_UNAVAILABLE",
    "BOOTSTRAP_FAILED", "STOP_DENIED", "VIEW_DENIED", "JOIN_FAILED",
    "ACK_DENIED", "QUARANTINE"))
UINT64 = (1 << 64) - 1
IDENTITY = re.compile(rb"0|[1-9][0-9]*", re.ASCII)
HEX = re.compile(r"[0-9a-f]{64}", re.ASCII)


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _json(raw, maximum):
    if isinstance(raw, str):
        raw = raw.encode("utf-8", "strict")
    if not isinstance(raw, bytes) or not 0 < len(raw) <= maximum:
        raise ValueError("Unbounded input")
    return json.loads(raw.decode("utf-8", "strict"),
                      object_pairs_hook=_unique_pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")),
                      parse_float=lambda _: (_ for _ in ()).throw(ValueError("float")))


def _uint(value, positive=False):
    return type(value) is int and (0 < value <= UINT64 if positive else 0 <= value <= UINT64)


def stage_inventory(base):
    """Observe every original node; never treat this as its bootstrap receipt."""
    base = Path(base)
    observed = {}
    def record(name):
        path = base / name
        entry = path.lstat()
        kind, mode = STAGE[name]
        if (entry.st_uid != 0 or entry.st_gid != 0
                or stat.S_IMODE(entry.st_mode) != mode
                or not (stat.S_ISDIR(entry.st_mode) if kind == "directory"
                        else stat.S_ISREG(entry.st_mode))
                or (kind == "regular" and entry.st_nlink != 1)):
            raise ValueError("Stage custody invalid: " + name)
        observed[name] = {
            "dev": entry.st_dev, "ino": entry.st_ino, "uid": entry.st_uid,
            "gid": entry.st_gid, "mode": stat.S_IMODE(entry.st_mode),
            "type": kind}
    record("")
    # lstat each child before traversal; no symlink following.
    def visit(directory):
        for node in (base / directory).iterdir():
            name = str(node.relative_to(base))
            if name not in STAGE:
                raise ValueError("Unexpected stage node: " + name)
            record(name)
            if STAGE[name][0] == "directory":
                visit(name)
    visit("")
    if set(observed) != set(STAGE):
        raise ValueError("Incomplete stage")
    return observed


def verify_stage_receipt(raw, observed):
    receipt = _json(raw, 16 * 1024)
    if (type(receipt) is not dict or set(receipt) != {"schemaVersion", "entries"}
            or type(receipt["schemaVersion"]) is not int
            or receipt["schemaVersion"] != 1
            or type(receipt["entries"]) is not dict
            or set(receipt["entries"]) != set(STAGE)
            or set(observed) != set(STAGE)):
        raise ValueError("Invalid original stage receipt")
    for name, expected in receipt["entries"].items():
        kind, mode = STAGE[name]
        if (type(expected) is not dict
                or set(expected) != {"dev", "ino", "uid", "gid", "mode", "type"}
                or expected["type"] != kind
                or type(expected["mode"]) is not int or expected["mode"] != mode
                or type(expected["uid"]) is not int or expected["uid"] != 0
                or type(expected["gid"]) is not int or expected["gid"] != 0
                or not _uint(expected["dev"])
                or not _uint(expected["ino"], True)
                or expected != observed[name]):
            raise ValueError("Staged identity mismatch: " + name)


def verify_stage_manifest(base):
    base = Path(base)
    manifest = _json((base / "manifest.json").read_bytes(), 4096)
    if (type(manifest) is not dict or
            set(manifest) != {"schemaVersion", "sourceSha256",
                             "controllerSha256", "binarySha256"}
            or type(manifest["schemaVersion"]) is not int
            or manifest["schemaVersion"] != 1):
        raise ValueError("Invalid stage manifest")
    for key, path in (
        ("sourceSha256", "native/ge04/cgroup-runtime-view-qualification.c"),
        ("controllerSha256", "tests/agents/test_ge04_runtime_view.py"),
        ("binarySha256", "bin/probe"),
    ):
        value = manifest[key]
        if (type(value) is not str or HEX.fullmatch(value) is None
                or hashlib.sha256((base / path).read_bytes()).hexdigest() != value):
            raise ValueError("Manifest digest mismatch: " + key)


def parse_event(raw):
    """Parse helper diagnostics; verification of kernel facts is separate."""
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 256 or not raw.endswith(b"\n"):
        raise ValueError("Bad bounded event")
    match = re.fullmatch(rb"EV ([A-Z_]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+)\n", raw)
    if not match:
        raise ValueError("Bad event grammar")
    phase = match.group(1).decode("ascii")
    if phase not in PHASES:
        raise ValueError("Unknown phase")
    nums = []
    for field in match.groups()[1:]:
        if not IDENTITY.fullmatch(field) or len(field) > 20:
            raise ValueError("Noncanonical integer")
        nums.append(int(field))
    for pid, ticks in ((nums[0], nums[1]), (nums[2], nums[3])):
        if not ((pid == 0 and ticks == 0)
                or (2 <= pid <= 2**31 - 1 and 0 < ticks <= UINT64)):
            raise ValueError("Invalid identity pair")
    return phase, tuple(nums)


def parse_result(raw):
    match = (re.fullmatch(rb"RESULT code=(0|77) reason=([A-Z_]+) clean=([01])\n", raw)
             if isinstance(raw, bytes) and len(raw) <= 128 else None)
    if not match:
        raise ValueError("Bad result")
    code = int(match.group(1))
    reason = match.group(2).decode("ascii")
    clean = int(match.group(3))
    if reason not in REASONS or (reason == "QUARANTINE" and (code != 77 or clean)):
        raise ValueError("Invalid result reason")
    return code, reason, clean


def parse_proc_stat(raw, expected_pid):
    """Extract kernel state/startticks from a bounded /proc/<pid>/stat read.

    /proc stat's parenthesized comm can contain spaces or closing parens.
    The pidfd and second generation read are still required for identity
    custody; this parser alone never authorizes an operation.
    """
    if (type(expected_pid) is not int or not 2 <= expected_pid <= 2**31 - 1
            or type(raw) is not bytes or not 0 < len(raw) <= 16384
            or not raw.endswith(b"\n")):
        raise ValueError("Invalid proc stat input")
    prefix = str(expected_pid).encode("ascii") + b" ("
    if not raw.startswith(prefix):
        raise ValueError("Proc PID mismatch")
    close = raw.rfind(b") ")
    if close <= len(prefix):
        raise ValueError("Invalid proc comm boundary")
    fields = raw[close + 2:].strip(b"\n").split(b" ")
    if len(fields) < 20 or any(not f for f in fields):
        raise ValueError("Incomplete proc stat")
    state = fields[0]
    ticks = fields[19]  # proc stat field 22, counting state as field 3
    if (len(state) != 1 or state not in (b"R", b"S", b"D", b"T", b"t",
                                       b"Z", b"X", b"I")
            or not IDENTITY.fullmatch(ticks) or int(ticks) == 0
            or int(ticks) > UINT64):
        raise ValueError("Invalid proc state or startticks")
    return state.decode("ascii"), int(ticks)


def parse_proc_status(raw, require_root=True):
    """Strictly parse real/effective/saved/filesystem UID and GID."""
    if type(raw) is not bytes or not 0 < len(raw) <= 16384:
        raise ValueError("Invalid proc status")
    fields = {}
    for line in raw.splitlines():
        if b":" not in line:
            raise ValueError("Malformed status line")
        name, value = line.split(b":", 1)
        if name in (b"Uid", b"Gid"):
            if name in fields:
                raise ValueError("Duplicate identity field")
            components = value.split()
            if (len(components) != 4 or
                    any(not IDENTITY.fullmatch(part) for part in components)):
                raise ValueError("Invalid proc identity")
            nums = tuple(int(part) for part in components)
            if any(not _uint(n) for n in nums):
                raise ValueError("Out-of-range identity")
            fields[name] = nums
    if set(fields) != {b"Uid", b"Gid"}:
        raise ValueError("Missing UID/GID")
    if require_root and any(n != 0 for group in fields.values() for n in group):
        raise ValueError("Observed process not root-owned")
    return fields[b"Uid"], fields[b"Gid"]


def parse_cgroup_procs(raw):
    """Require unique, canonical bounded PIDs, not a prefix PID match."""
    if type(raw) is not bytes or len(raw) > 4096:
        raise ValueError("Invalid cgroup.procs")
    if raw and not raw.endswith(b"\n"):
        raise ValueError("Truncated membership")
    values = []
    for item in raw.splitlines():
        if (not IDENTITY.fullmatch(item) or len(item) > 10 or
                not 2 <= int(item) <= 2**31 - 1):
            raise ValueError("Invalid member")
        values.append(int(item))
    if len(values) != len(set(values)) or len(values) > 128:
        raise ValueError("Duplicate or oversized members")
    return frozenset(values)


def check_reported_generation(pair, stat_raw, status_raw, members_raw,
                              require_root=True):
    """Read-only corroboration of one report, NOT a full observer/ACK gate."""
    pid, ticks = pair
    if (type(pid) is not int or type(ticks) is not int
            or not 2 <= pid <= 2**31 - 1 or not 0 < ticks <= UINT64):
        raise ValueError("Invalid reported generation")
    state, observed = parse_proc_stat(stat_raw, pid)
    parse_proc_status(status_raw, require_root=require_root)
    if observed != ticks or pid not in parse_cgroup_procs(members_raw):
        raise ValueError("Kernel generation or membership mismatch")
    return state


def parse_cgroup_events(raw):
    """Parse only required cgroup v2 event counters; no ownership claim."""
    if type(raw) is not bytes or not 0 < len(raw) <= 4096 or not raw.endswith(b"\n"):
        raise ValueError("Invalid cgroup.events")
    events = {}
    for line in raw.splitlines():
        parts = line.split(b" ")
        if (len(parts) != 2 or parts[0] not in (b"populated", b"frozen")
                or parts[0] in events or not IDENTITY.fullmatch(parts[1])
                or int(parts[1]) not in (0, 1)):
            raise ValueError("Noncanonical cgroup event")
        events[parts[0]] = int(parts[1])
    if b"populated" not in events:
        raise ValueError("Missing populated counter")
    return {key.decode("ascii"): value for key, value in events.items()}


def parse_subtree_control(raw):
    """Closed, canonical cgroup v2 subtree_control token set."""
    if type(raw) is not bytes or len(raw) > 128:
        raise ValueError("Invalid subtree control")
    if raw in (b"", b"\n"):
        return frozenset()
    if not raw.endswith(b"\n"):
        raise ValueError("Truncated subtree control")
    tokens = raw[:-1].split(b" ")
    allowed = (b"cpu", b"memory", b"pids")
    if any(token not in allowed for token in tokens) or len(set(tokens)) != len(tokens):
        raise ValueError("Unexpected subtree controller")
    if tokens != sorted(tokens):
        raise ValueError("Noncanonical controller order")
    return frozenset(token.decode("ascii") for token in tokens)


def parse_fd_inventory(names):
    """Exact numeric FD name set from a supplied directory listing."""
    if not isinstance(names, (tuple, list)) or len(names) > 256:
        raise ValueError("Unbounded FD inventory")
    result = set()
    for name in names:
        if (type(name) is not str or not re.fullmatch(r"0|[1-9][0-9]*", name)
                or len(name) > 10 or int(name) > 1048576
                or int(name) in result):
            raise ValueError("Invalid or duplicate FD")
        result.add(int(name))
    return frozenset(result)


def check_fd_inventory(names, expected):
    """Fail closed for extra/missing FD numbers; not descriptor identity."""
    observed = parse_fd_inventory(names)
    if (type(expected) is not frozenset
            or any(type(fd) is not int or fd < 0 for fd in expected)
            or observed != expected):
        raise ValueError("FD inventory mismatch")
    return observed


def verify_phase_cgroup_snapshot(phase, pair_a, pair_b, outer_raw,
                                 launcher_raw, payload_raw, outer_events,
                                 launcher_events, payload_events,
                                 controllers_raw):
    """Pure exact-membership phase check over caller-supplied bytes, NOT ACK proof.

    No protected cgroup descriptor or parent-unit binding is established here.
    This narrow contract covers INTENT through READY, not EMPTY/recovery/denial.
    """
    positions = {
        "INTENT": ("none", False),
        "PRE_NAMESPACE": ("outer", False),
        "PINNED": ("launcher", False),
        "ENABLED": ("launcher", True),
        "PRE_JOIN": ("joined", True),
        "READY": ("joined", True),
    }
    if type(phase) is not str or phase not in positions:
        raise ValueError("Unsupported cgroup phase")
    for pair in (pair_a, pair_b):
        if (type(pair) is not tuple or len(pair) != 2
                or type(pair[0]) is not int or type(pair[1]) is not int):
            raise ValueError("Invalid observed generation")
        pid, ticks = pair
        if pair != (0, 0) and not (2 <= pid <= 2**31 - 1 and 0 < ticks <= UINT64):
            raise ValueError("Invalid observed generation")
    location, enabled = positions[phase]
    if ((location == "none" and (pair_a != (0, 0) or pair_b != (0, 0)))
            or (location != "none" and pair_a == (0, 0))
            or (location != "joined" and pair_b != (0, 0))
            or (location == "joined" and pair_b == (0, 0))
            or (pair_a[0] == pair_b[0] and pair_a != (0, 0))):
        raise ValueError("Impossible phase generations")
    expected_outer = frozenset((pair_a[0],)) if location == "outer" else frozenset()
    expected_launcher = (frozenset((pair_a[0], pair_b[0])) if location == "joined"
                         else frozenset((pair_a[0],)) if location == "launcher"
                         else frozenset())
    if (parse_cgroup_procs(outer_raw) != expected_outer
            or parse_cgroup_procs(launcher_raw) != expected_launcher
            or parse_cgroup_procs(payload_raw)):
        raise ValueError("Unexpected cgroup membership")
    observed_events = (
        parse_cgroup_events(outer_events),
        parse_cgroup_events(launcher_events),
        parse_cgroup_events(payload_events),
    )
    expected_populated = (int(location != "none"),
                          int(location in ("launcher", "joined")), 0)
    if any(observed["populated"] != expect
           for observed, expect in zip(observed_events, expected_populated)):
        raise ValueError("Cgroup populated mismatch")
    required = frozenset(("cpu", "memory", "pids")) if enabled else frozenset()
    if parse_subtree_control(controllers_raw) != required:
        raise ValueError("Wrong phase controllers")
    return True


def parse_cgroup2_mountinfo(raw, expected_mountpoint=b"/sys/fs/cgroup"):
    """Parse exactly one root-mounted cgroup2 entry from supplied mountinfo.

    This is a syntax/consistency check, not mount namespace or trusted root
    identity. A future protected observer must independently pin mount IDs.
    """
    if (type(raw) is not bytes or not 0 < len(raw) <= 1024 * 1024
            or not raw.endswith(b"\n") or type(expected_mountpoint) is not bytes
            or not expected_mountpoint.startswith(b"/")
            or b" " in expected_mountpoint or bytes((0,)) in expected_mountpoint):
        raise ValueError("Invalid mountinfo observation")
    candidates = []
    for line in raw.splitlines():
        if b" - " not in line:
            raise ValueError("Invalid mountinfo separator")
        left, right = line.split(b" - ", 1)
        fields = left.split(b" ")
        after = right.split(b" ")
        if len(fields) < 6 or len(after) < 3:
            raise ValueError("Malformed mountinfo entry")
        if after[0] != b"cgroup2":
            continue
        if (len(fields[0]) > 20 or not IDENTITY.fullmatch(fields[0])
                or int(fields[0]) == 0 or fields[3] != b"/"
                or fields[4] != expected_mountpoint):
            raise ValueError("Unexpected cgroup2 mount scope")
        if (b"\\" in fields[3] or b"\\" in fields[4]
                or len(fields[2]) > 40 or not re.fullmatch(rb"[0-9]+:[0-9]+", fields[2])):
            raise ValueError("Untrusted mountinfo identity")
        candidates.append((int(fields[0]), fields[2].decode("ascii")))
    if len(candidates) != 1:
        raise ValueError("Missing or ambiguous cgroup2 mount")
    return candidates[0]


def read_bound_cgroup_snapshot(path, expected_identity):
    """Read local cgroup files through a held directory FD (no mutations).

    expected_identity must be independently supplied, never freshly
    synthesized from the same read. Test fixture paths are acceptable here;
    no identity of the containing systemd unit or host mount is proven.
    """
    if (not isinstance(path, (str, bytes, os.PathLike))
            or type(expected_identity) is not tuple or len(expected_identity) != 2
            or any(type(n) is not int or n <= 0 for n in expected_identity)):
        raise ValueError("Invalid protected cgroup binding request")
    directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                        | os.O_CLOEXEC)
    try:
        before = os.fstat(directory)
        if (not stat.S_ISDIR(before.st_mode)
                or (before.st_dev, before.st_ino) != expected_identity):
            raise ValueError("Cgroup directory identity mismatch")
        output = {}
        for filename, cap in (("cgroup.procs", 4096), ("cgroup.events", 4096),
                              ("cgroup.subtree_control", 128)):
            fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                         | os.O_CLOEXEC, dir_fd=directory)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError("Unexpected cgroup control file type")
                raw = bytearray()
                while len(raw) <= cap:
                    chunk = os.read(fd, min(4096, cap + 1 - len(raw)))
                    if not chunk:
                        break
                    raw.extend(chunk)
                if len(raw) > cap:
                    raise ValueError("Oversized cgroup control file")
                output[filename] = bytes(raw)
            finally:
                os.close(fd)
        parse_cgroup_procs(output["cgroup.procs"])
        parse_cgroup_events(output["cgroup.events"])
        parse_subtree_control(output["cgroup.subtree_control"])
        after = os.fstat(directory)
        if (after.st_dev, after.st_ino) != expected_identity:
            raise ValueError("Cgroup directory identity changed")
        current = os.stat(path, follow_symlinks=False)
        if (not stat.S_ISDIR(current.st_mode)
                or (current.st_dev, current.st_ino) != expected_identity):
            raise ValueError("Cgroup path replaced during observation")
        return output
    finally:
        os.close(directory)


def observe_bound_cgroup_ancestry(root_path, components, expected_chain):
    """Read-only pinned directory-chain observations, never cgroup authority.

    Paths must be relative, fixed single components. Expected dev/ino pairs
    come from a separate trusted binding; collecting them here never creates it.
    This check does not pin systemd unit ancestry or Linux mount IDs.
    """
    if (not isinstance(root_path, (str, bytes, os.PathLike))
            or type(components) is not tuple or not 1 <= len(components) <= 8
            or type(expected_chain) is not tuple
            or len(expected_chain) != len(components) + 1):
        raise ValueError("Invalid cgroup ancestry contract")
    for component in components:
        if (type(component) is not str or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", component)
                or component in (".", "..")):
            raise ValueError("Untrusted cgroup path component")
    for identity in expected_chain:
        if (type(identity) is not tuple or len(identity) != 2
                or any(type(part) is not int or part <= 0 for part in identity)):
            raise ValueError("Invalid expected cgroup identity")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    opened = []
    try:
        opened.append(os.open(root_path, flags))
        for component in components:
            opened.append(os.open(component, flags, dir_fd=opened[-1]))
        # Validate every opened inode before and after reconciling its path.
        for index, fd in enumerate(opened):
            found = os.fstat(fd)
            if (not stat.S_ISDIR(found.st_mode)
                    or (found.st_dev, found.st_ino) != expected_chain[index]):
                raise ValueError("Cgroup ancestry identity mismatch")
        for index in range(1, len(opened)):
            path_stat = os.stat(components[index-1], dir_fd=opened[index-1],
                                follow_symlinks=False)
            if (not stat.S_ISDIR(path_stat.st_mode)
                    or (path_stat.st_dev, path_stat.st_ino) != expected_chain[index]):
                raise ValueError("Cgroup ancestry path substituted")
        root_stat = os.stat(root_path, follow_symlinks=False)
        if (not stat.S_ISDIR(root_stat.st_mode)
                or (root_stat.st_dev, root_stat.st_ino) != expected_chain[0]):
            raise ValueError("Cgroup root path substituted")
        for index, fd in enumerate(opened):
            found = os.fstat(fd)
            if (found.st_dev, found.st_ino) != expected_chain[index]:
                raise ValueError("Cgroup ancestry changed")
        return expected_chain
    finally:
        for fd in reversed(opened):
            os.close(fd)


def validate_external_cgroup_binding(binding, observed):
    """Corroborate a *supplied* immutable unit/mount/keeper record, never issue it.

    Both arguments can be forged by a caller. Only independently protected
    records and actual kernel observations can make this useful to a future
    staged root controller. This pure validator grants no launch/ACK authority.
    """
    required = frozenset(("invocation", "unit", "mountId", "mountDevice",
                          "mountRoot", "keeperPid", "keeperTicks", "ancestry"))
    def checked(value):
        if type(value) is not dict or frozenset(value) != required:
            raise ValueError("Incomplete external cgroup binding")
        if (type(value["invocation"]) is not str
                or re.fullmatch(r"[0-9a-f]{32}", value["invocation"]) is None
                or type(value["unit"]) is not str
                or value["unit"] != "ge04-r1b2-view-qualification.service"
                or type(value["mountRoot"]) is not str or value["mountRoot"] != "/"
                or type(value["mountDevice"]) is not str
                or re.fullmatch(r"[0-9]+:[0-9]+", value["mountDevice"]) is None
                or any(type(value[key]) is not int or value[key] <= 0
                       for key in ("mountId", "keeperTicks"))
                or type(value["keeperPid"]) is not int
                or not 2 <= value["keeperPid"] <= 2**31 - 1
                or type(value["ancestry"]) is not tuple
                or len(value["ancestry"]) != 3):
            raise ValueError("Malformed external cgroup binding")
        for identity in value["ancestry"]:
            if (type(identity) is not tuple or len(identity) != 2
                    or any(type(n) is not int or n <= 0 for n in identity)):
                raise ValueError("Malformed cgroup ancestor identity")
    checked(binding)
    checked(observed)
    if binding != observed:
        raise ValueError("Cgroup mount, unit, invocation or keeper binding changed")
    return True


def _read_proc_file(pid, name, cap=16384):
    """Read one procfs regular file without following a final-component link.

    This is a read-only local primitive, not a complete procfs ancestry trust
    proof.  A privileged controller must additionally pin procfs and bind
    ownership before using its observation for ACK.
    """
    if (type(pid) is not int or not 2 <= pid <= 2**31 - 1
            or name not in ("stat", "status")):
        raise ValueError("Invalid proc observation target")
    fd = os.open(f"/proc/{pid}/{name}",
                 os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("Unexpected proc file type")
        result = bytearray()
        while len(result) <= cap:
            block = os.read(fd, min(4096, cap + 1 - len(result)))
            if not block:
                break
            result.extend(block)
        if len(result) > cap or not result:
            raise ValueError("Unbounded or empty proc observation")
        return bytes(result)
    finally:
        os.close(fd)


def observe_live_generation(pair, expected_uid=None, expected_gid=None):
    """Read-only double-observation of a live process with observer-owned pidfd.

    No cgroup mutation, signalling, namespace entry or acknowledgement.
    Result cannot supply authority to a root controller: cgroup membership,
    host unit binding, namespace and fd custody remain unverified here.
    """
    if not isinstance(pair, tuple) or len(pair) != 2:
        raise ValueError("Invalid generation pair")
    pid, ticks = pair
    if (type(pid) is not int or type(ticks) is not int or
            not 2 <= pid <= 2**31 - 1 or not 0 < ticks <= UINT64):
        raise ValueError("Invalid process generation")
    if not hasattr(os, "pidfd_open"):
        raise RuntimeError("Kernel pidfd inspection unavailable")
    def stat_sample():
        state, observed_ticks = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
        if observed_ticks != ticks or state in ("Z", "X"):
            raise ValueError("Process generation not live")
        return state
    # First generation check precedes observer-owned pidfd_open.
    before = stat_sample()
    fd = os.pidfd_open(pid, 0)
    try:
        poller = select.poll()
        poller.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        if poller.poll(0):
            raise ValueError("Process pidfd already exited")
        uid, gid = parse_proc_status(_read_proc_file(pid, "status"),
                                     require_root=False)
        if (expected_uid is not None and
                (type(expected_uid) is not int or uid != (expected_uid,) * 4)):
            raise ValueError("Process UID custody mismatch")
        if (expected_gid is not None and
                (type(expected_gid) is not int or gid != (expected_gid,) * 4)):
            raise ValueError("Process GID custody mismatch")
        after = stat_sample()
        if poller.poll(0):
            raise ValueError("Process exited during observation")
        if before != after:
            raise ValueError("Process state changed during observation")
        return {"pid": pid, "startticks": ticks, "state": after,
                "uid": uid, "gid": gid}
    finally:
        os.close(fd)


def observe_namespace_links(pair):
    """Read-only mnt/cgroup nsfs inode snapshots, not namespace custody.

    This function obtains no target authority and performs no setns.  The
    caller must independently pin the process generation and procfs ancestry;
    one pair of observations does not exclude a namespace transition.
    """
    if (not isinstance(pair, tuple) or len(pair) != 2 or
            type(pair[0]) is not int or type(pair[1]) is not int or
            not 2 <= pair[0] <= 2**31 - 1 or not 0 < pair[1] <= UINT64):
        raise ValueError("Invalid process generation")
    pid, ticks = pair
    _, observed = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
    if observed != ticks:
        raise ValueError("Generation mismatch before namespace observation")
    found = {}
    for kind in ("mnt", "cgroup"):
        path = f"/proc/{pid}/ns/{kind}"
        target = os.readlink(path)
        match = re.fullmatch(rf"{kind}:\[([1-9][0-9]*)\]", target)
        if not match or int(match.group(1)) > UINT64:
            raise ValueError("Malformed namespace link")
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_ino != int(match.group(1)):
                raise ValueError("Namespace link and inode mismatch")
            found[kind] = (info.st_dev, info.st_ino)
        finally:
            os.close(fd)
    _, second = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
    if second != ticks:
        raise ValueError("Generation mismatch after namespace observation")
    return found


class BoundedPhasePipe:
    """Unbuffered finite-deadline diagnostics reader; never grants ACK authority.

    Reads exactly one canonical line per call, retaining a possible partial
    subsequent line.  Does not use TextIO or reset the caller's deadline.
    """

    def __init__(self, fd):
        self.fd = fd
        self.pending = bytearray()

    def line(self, until):
        while True:
            newline = self.pending.find(b"\n")
            if newline >= 0:
                if newline >= 256:
                    raise ValueError("Oversized helper line")
                line = bytes(self.pending[:newline + 1])
                del self.pending[:newline + 1]
                return line
            if len(self.pending) >= 256:
                raise ValueError("Oversized unterminated helper line")
            remaining = until - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Helper diagnostic phase deadline")
            try:
                ready, _, _ = select.select([self.fd], [], [], remaining)
            except InterruptedError:
                continue
            if not ready:
                raise TimeoutError("Helper diagnostic phase deadline")
            try:
                chunk = os.read(self.fd, 256 - len(self.pending))
            except InterruptedError:
                continue
            if not chunk:
                raise EOFError("Helper diagnostic stream ended before newline")
            self.pending.extend(chunk)


class PhaseSequence:
    """Enforce exact phase progression, never substitute this for kernel proof."""

    def __init__(self, mode):
        expected = {
            "run": ("INTENT", "PRE_NAMESPACE", "PINNED",
                    "ENABLED", "PRE_JOIN", "READY", "EMPTY"),
            "crash-pre-namespace": ("INTENT", "PRE_NAMESPACE"),
            "crash-pinned": ("INTENT", "PRE_NAMESPACE", "PINNED"),
            "crash-ready": ("INTENT", "PRE_NAMESPACE", "PINNED",
                            "ENABLED", "PRE_JOIN", "READY"),
            "fail-mount": ("INTENT", "PRE_NAMESPACE", "EMPTY"),
            "fail-enable": ("INTENT", "PRE_NAMESPACE", "PINNED", "EMPTY"),
            "recover": ("EMPTY",),
            "sweep-empty": (),
        }
        if mode not in expected:
            raise ValueError("Unknown closed mode")
        self.mode = mode
        self.expected = expected[mode]
        self.position = 0
        self.generations = [None, None]

    def accept(self, raw):
        phase, fields = parse_event(raw)
        if self.position >= len(self.expected) or phase != self.expected[self.position]:
            raise ValueError("Unexpected phase order")
        pair_a, pair_b = fields[:2], fields[2:]
        if phase == "INTENT" and (pair_a != (0, 0) or pair_b != (0, 0)):
            raise ValueError("Intent must precede child birth")
        if phase not in ("INTENT", "EMPTY"):
            if pair_a == (0, 0):
                raise ValueError("Missing first child identity")
            if phase in ("PRE_JOIN", "READY") and pair_b == (0, 0):
                raise ValueError("Missing second child identity")
            if phase not in ("PRE_JOIN", "READY") and pair_b != (0, 0):
                raise ValueError("Unexpected second child")
        for i, pair in enumerate((pair_a, pair_b)):
            if pair != (0, 0):
                if self.generations[i] is not None and pair != self.generations[i]:
                    raise ValueError("Process generation changed")
                self.generations[i] = pair
        self.position += 1
        return phase, fields

    def complete(self):
        if self.position != len(self.expected):
            raise ValueError("Missing required helper phases")


def evaluate_closed_qualification_transcript(mode, event_lines, result_raw=None,
                                             exit_status=None, cleanup=None):
    """Classify a bounded fixture transcript without granting execution authority.

    All arguments are untrusted diagnostics; this pure function **never**
    approves worker admission, root qualification, recovery, or final effects.
    A protected kernel observer must validate each phase independently.
    """
    if (type(event_lines) not in (list, tuple) or len(event_lines) > 8
            or any(type(event) is not bytes or len(event) > 256 for event in event_lines)):
        raise ValueError("Oversized qualification transcript")
    sequence = PhaseSequence(mode)
    for event in event_lines:
        sequence.accept(event)
    sequence.complete()
    crash_modes = frozenset(("crash-pre-namespace", "crash-pinned", "crash-ready"))
    if mode in crash_modes:
        if result_raw is not None or type(exit_status) is not int or exit_status != 88:
            raise ValueError("Crash injection must lack terminal result")
        if cleanup is not None:
            raise ValueError("Unobserved crash cannot claim cleanup")
        return "QUARANTINE_PENDING_RECOVERY"
    if type(result_raw) is not bytes or exit_status is not None:
        raise ValueError("Missing or contradictory fixture result")
    code, reason, clean = parse_result(result_raw)
    expected = {
        "run": (0, "COMPLETED", 1),
        "recover": (0, "RECOVERED", 1),
        "sweep-empty": (0, "EMPTY_SWEEP", 1),
        "fail-mount": (77, "MOUNT_INJECTED", 1),
        "fail-enable": (77, "ENABLE_EBADF", 1),
    }
    if (mode not in expected or (code, reason, clean) != expected[mode]
            or type(cleanup) is not dict or
            frozenset(cleanup) != frozenset(("outerMembers", "launcherMembers",
                                           "payloadMembers", "outerPopulated",
                                           "launcherPopulated", "payloadPopulated",
                                           "originalBindingIntact"))):
        raise ValueError("Terminal fixture state invalid or uncorroborated")
    if (not cleanup["originalBindingIntact"] is True
            or any(type(cleanup[key]) is not bytes for key in
                   ("outerMembers", "launcherMembers", "payloadMembers"))
            or any(type(cleanup[key]) is not int or cleanup[key] != 0 for key in
                   ("outerPopulated", "launcherPopulated", "payloadPopulated"))
            or any(parse_cgroup_procs(cleanup[key]) for key in
                   ("outerMembers", "launcherMembers", "payloadMembers"))):
        raise ValueError("Cleanup state not empty or binding lost")
    # Caller-supplied cleanup cannot establish actual kernel emptiness.
    return "LOCAL_CONTRACT_ONLY"


def root_qualification_refused():
    """Deliberately fail closed until full kernel observer and cleanup review."""
    if ROOT != CODE:
        raise RuntimeError("Root qualification cannot execute from checkout")
    if not (os.getuid() == os.geteuid() == os.getgid() == os.getegid() == 0
            and os.environ.get("ALIX_GE04_PRIVILEGED_QUALIFICATION") == "1"
            and os.environ.get("ALIX_GE04_RUNTIME_VIEW_QUALIFICATION") == "1"):
        raise RuntimeError("Root qualification flags/identity not established")
    observed = stage_inventory(CODE)
    verify_stage_receipt(os.environ.get("ALIX_GE04_VIEW_STAGE_IDENTITIES", ""), observed)
    verify_stage_manifest(CODE)
    raise RuntimeError("GE-04 runtime-view live controller not implemented; SECURITY HOLD")


class LocalContractTests(unittest.TestCase):
    def test_phase_grammar(self):
        self.assertEqual(parse_event(b"EV INTENT 0 0 0 0\n"), ("INTENT", (0, 0, 0, 0)))
        self.assertEqual(parse_event(b"EV READY 123 456 789 1011\n"),
                         ("READY", (123, 456, 789, 1011)))

    def test_phase_refusals(self):
        invalid = (b"EV READY 0 1 0 0\n", b"EV READY 1 3 0 0\n",
                   b"EV READY 03 4 0 0\n", b"EV UNKNOWN 0 0 0 0\n",
                   b"EV READY 3 4 0 0\nX", b"EV READY 3 4 0 0",
                   b"EV READY 3 4 0 0\n" + b" " * 250,
                   b"EV READY 3 18446744073709551616 0 0\n")
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_event(raw)

    def test_result_grammar(self):
        self.assertEqual(parse_result(b"RESULT code=77 reason=QUARANTINE clean=0\n"),
                         (77, "QUARANTINE", 0))
        for raw in (b"RESULT code=0 reason=QUARANTINE clean=1\n",
                    b"RESULT code=88 reason=COMPLETED clean=0\n",
                    b"RESULT code=77 reason=MADE_UP clean=1\n"):
            with self.assertRaises(ValueError):
                parse_result(raw)

    def test_receipt_rejects_malformed(self):
        observed = {name: {"dev": 1, "ino": 2, "uid": 0, "gid": 0,
                   "mode": mode, "type": kind} for name, (kind, mode) in STAGE.items()}
        good = {"schemaVersion": 1, "entries": observed}
        verify_stage_receipt(json.dumps(good), observed)
        for malformed in ('{"schemaVersion":1,"schemaVersion":1,"entries":{}}',
                          '{"schemaVersion":true,"entries":{}}',
                          json.dumps({"schemaVersion": 1, "entries": {**observed,
                                       "extra": observed[""]}}),
                          json.dumps({"schemaVersion": 1, "entries": {**observed,
                                       "": {**observed[""], "ino": True}}})):
            with self.subTest(raw=malformed), self.assertRaises(ValueError):
                verify_stage_receipt(malformed, observed)

    def test_binary_pipe_coalesced_and_split(self):
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        reader = BoundedPhasePipe(read_fd)
        os.write(write_fd, b"EV INTENT 0 0 0 0\nEV PRE_")
        self.assertEqual(reader.line(time.monotonic() + 0.1),
                         b"EV INTENT 0 0 0 0\n")
        os.write(write_fd, b"NAMESPACE 10 20 0 0\n")
        self.assertEqual(reader.line(time.monotonic() + 0.1),
                         b"EV PRE_NAMESPACE 10 20 0 0\n")

    def test_binary_pipe_deadline_eof_and_oversize(self):
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        reader = BoundedPhasePipe(read_fd)
        with self.assertRaises(TimeoutError):
            reader.line(time.monotonic() - 1)
        os.write(write_fd, b"x" * 256)
        with self.assertRaises(ValueError):
            reader.line(time.monotonic() + 0.1)
        os.close(write_fd)
        with self.assertRaises(ValueError):
            reader.line(time.monotonic() + 0.1)
        read2, write2 = os.pipe()
        self.addCleanup(os.close, read2)
        os.close(write2)
        with self.assertRaises(EOFError):
            BoundedPhasePipe(read2).line(time.monotonic() + 0.1)

    def test_phase_sequence_and_generation(self):
        sequence = PhaseSequence("run")
        raw = (
            b"EV INTENT 0 0 0 0\n",
            b"EV PRE_NAMESPACE 10 100 0 0\n",
            b"EV PINNED 10 100 0 0\n",
            b"EV ENABLED 10 100 0 0\n",
            b"EV PRE_JOIN 10 100 11 101\n",
            b"EV READY 10 100 11 101\n",
            b"EV EMPTY 0 0 0 0\n",
        )
        for event in raw:
            sequence.accept(event)
        sequence.complete()
        with self.assertRaises(ValueError):
            sequence.accept(raw[-1])
        mismatch = PhaseSequence("run")
        mismatch.accept(raw[0])
        mismatch.accept(raw[1])
        with self.assertRaises(ValueError):
            mismatch.accept(b"EV PINNED 10 101 0 0\n")
        with self.assertRaises(ValueError):
            mismatch.complete()

    def test_injections_require_prerequisite_phases(self):
        for mode, accepted in (
            ("fail-mount", (b"EV INTENT 0 0 0 0\n",
                            b"EV PRE_NAMESPACE 10 100 0 0\n",
                            b"EV EMPTY 0 0 0 0\n")),
            ("fail-enable", (b"EV INTENT 0 0 0 0\n",
                             b"EV PRE_NAMESPACE 10 100 0 0\n",
                             b"EV PINNED 10 100 0 0\n",
                             b"EV EMPTY 0 0 0 0\n")),
        ):
            sequence = PhaseSequence(mode)
            for event in accepted:
                sequence.accept(event)
            sequence.complete()
        incomplete = PhaseSequence("fail-enable")
        incomplete.accept(b"EV INTENT 0 0 0 0\n")
        with self.assertRaises(ValueError):
            incomplete.accept(b"EV EMPTY 0 0 0 0\n")

    @staticmethod
    def _proc_stat(pid=17, ticks=987654, state=b"T", comm=b"test ) odd"):
        # Kernel fields: state=3, ppid=4, ... starttime=22.
        return (str(pid).encode() + b" (" + comm + b") " + state +
                b" 1" * 18 + b" " + str(ticks).encode() + b" 0 0\n")

    def test_proc_generation_parsing(self):
        self.assertEqual(parse_proc_stat(self._proc_stat(), 17), ("T", 987654))
        for raw, pid in (
            (self._proc_stat(pid=18), 17),
            (self._proc_stat(ticks=0), 17),
            (self._proc_stat()[:-1], 17),
            (b"17 (short) T 1\n", 17),
            (self._proc_stat(), True),
        ):
            with self.subTest(raw=raw, pid=pid), self.assertRaises(ValueError):
                parse_proc_stat(raw, pid)

    def test_proc_identity_and_membership(self):
        root_status = b"Name:\ttest\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n"
        self.assertEqual(parse_proc_status(root_status), ((0, 0, 0, 0), (0, 0, 0, 0)))
        self.assertEqual(parse_cgroup_procs(b"17\n23\n"), frozenset((17, 23)))
        self.assertEqual(check_reported_generation(
            (17, 987654), self._proc_stat(), root_status, b"17\n"), "T")
        for raw in (root_status.replace(b"Uid:\t0", b"Uid:\t1", 1),
                    root_status + b"Uid:\t0\t0\t0\t0\n",
                    b"Name:\ttest\n"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_proc_status(raw)
        for raw in (b"17\n17\n", b"017\n", b"0\n", b"17", b"17\n0\n"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_cgroup_procs(raw)
        with self.assertRaises(ValueError):
            check_reported_generation(
                (17, 987655), self._proc_stat(), root_status, b"17\n")
        with self.assertRaises(ValueError):
            check_reported_generation(
                (17, 987654), self._proc_stat(), root_status, b"23\n")

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"),
                         "Linux pidfd required; skip is not qualification")
    def test_live_pidfd_double_observation(self):
        pid = os.getpid()
        _, ticks = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
        observed = observe_live_generation(
            (pid, ticks), expected_uid=os.getuid(), expected_gid=os.getgid())
        self.assertEqual(observed["pid"], pid)
        self.assertEqual(observed["startticks"], ticks)
        self.assertEqual(observed["uid"], (os.getuid(),) * 4)
        self.assertEqual(observed["gid"], (os.getgid(),) * 4)

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"),
                         "Linux pidfd required; skip is not qualification")
    def test_live_pidfd_fail_closed_mismatch(self):
        pid = os.getpid()
        _, ticks = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
        for pair, uid, gid in (
            ((pid, ticks + 1), os.getuid(), os.getgid()),
            ((pid, ticks), os.getuid() + 1, os.getgid()),
            ((pid, ticks), os.getuid(), os.getgid() + 1),
            ((True, ticks), os.getuid(), os.getgid()),
        ):
            with self.subTest(pair=pair, uid=uid, gid=gid):
                with self.assertRaises(ValueError):
                    observe_live_generation(pair, expected_uid=uid, expected_gid=gid)

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"),
                         "Linux namespace links required; skip is not qualification")
    def test_live_namespace_link_observation(self):
        pid = os.getpid()
        _, ticks = parse_proc_stat(_read_proc_file(pid, "stat"), pid)
        observed = observe_namespace_links((pid, ticks))
        self.assertEqual(set(observed), {"mnt", "cgroup"})
        self.assertTrue(all(dev > 0 and ino > 0 for dev, ino in observed.values()))
        with self.assertRaises(ValueError):
            observe_namespace_links((pid, ticks + 1))
        with self.assertRaises(ValueError):
            observe_namespace_links((True, ticks))

    def test_cgroup_event_and_control_contract(self):
        self.assertEqual(parse_cgroup_events(b"populated 0\nfrozen 1\n"),
                         {"populated": 0, "frozen": 1})
        self.assertEqual(parse_subtree_control(b"cpu memory pids\n"),
                         frozenset(("cpu", "memory", "pids")))
        self.assertEqual(parse_subtree_control(b"\n"), frozenset())
        for raw in (b"", b"populated 2\n", b"populated 0\npopulated 1\n",
                    b"populated 0", b"frozen 0\n", b"populated 00\n",
                    b"populated 0\nunknown 1\n"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_cgroup_events(raw)
        for raw in (b"cpu memory", b"memory cpu\n", b"cpu cpu\n",
                    b"cpu io\n", b"cpu  memory\n"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_subtree_control(raw)

    def test_exact_fd_number_inventory_contract(self):
        self.assertEqual(check_fd_inventory(["0", "1", "2", "3"],
                                            frozenset((0, 1, 2, 3))),
                         frozenset((0, 1, 2, 3)))
        for raw in (["0", "1", "3"], ["0", "1", "2", "3", "4"],
                    ["0", "1", "2", "2"], ["00", "1", "2", "3"],
                    ["0", "1", "2", "-1"], ["0", "1", "2", "fd"]):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                check_fd_inventory(raw, frozenset((0, 1, 2, 3)))

    @staticmethod
    def _phase_snapshot(phase):
        a, b = (17, 1234), (23, 4567)
        outer_members = b"17\n" if phase == "PRE_NAMESPACE" else b""
        launcher_members = (b"17\n23\n" if phase in ("PRE_JOIN", "READY")
                            else b"17\n" if phase in ("PINNED", "ENABLED")
                            else b"")
        outer_populated = 0 if phase == "INTENT" else 1
        launcher_populated = int(phase in ("PINNED", "ENABLED", "PRE_JOIN", "READY"))
        return (
            phase, a if phase != "INTENT" else (0, 0),
            b if phase in ("PRE_JOIN", "READY") else (0, 0),
            outer_members, launcher_members, b"",
            f"populated {outer_populated}\n".encode(),
            f"populated {launcher_populated}\n".encode(),
            b"populated 0\n",
            b"cpu memory pids\n" if phase in ("ENABLED", "PRE_JOIN", "READY") else b"\n",
        )

    def test_phase_cgroup_snapshot_exact_membership(self):
        for phase in ("INTENT", "PRE_NAMESPACE", "PINNED", "ENABLED",
                      "PRE_JOIN", "READY"):
            with self.subTest(phase=phase):
                self.assertTrue(verify_phase_cgroup_snapshot(*self._phase_snapshot(phase)))

    def test_phase_cgroup_snapshot_rejects_unexpected_members(self):
        reference = list(self._phase_snapshot("READY"))
        for idx, replacement in ((3, b"17\n"), (4, b"17\n24\n"),
                                 (5, b"99\n"), (6, b"populated 0\n"),
                                 (7, b"populated 0\n"),
                                 (8, b"populated 1\n"), (9, b"cpu memory\n"),
                                 (1, (17, 0)), (2, (17, 4567))):
            case = reference.copy()
            case[idx] = replacement
            with self.subTest(field=idx, replacement=replacement):
                with self.assertRaises(ValueError):
                    verify_phase_cgroup_snapshot(*case)
        for phase in ("EMPTY", "DENIED", "RUNNING"):
            case = reference.copy()
            case[0] = phase
            with self.subTest(phase=phase), self.assertRaises(ValueError):
                verify_phase_cgroup_snapshot(*case)

    def test_cgroup2_mountinfo_root_scope(self):
        good = (b"29 22 0:27 / /sys/fs/cgroup rw,nosuid,nodev - "
                b"cgroup2 cgroup rw\n")
        self.assertEqual(parse_cgroup2_mountinfo(good), (29, "0:27"))
        for raw in (
            b"", good[:-1], good + good,
            good.replace(b" / /sys", b" /nested /sys"),
            good.replace(b"/sys/fs/cgroup", b"/sys/fs/cgroup/other"),
            good.replace(b"0:27", b"wrong"),
            good.replace(b"29 22", b"0 22"),
            good.replace(b" - ", b" : "),
        ):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_cgroup2_mountinfo(raw)
        with self.assertRaises(ValueError):
            parse_cgroup2_mountinfo(good, b"/sys/fs/cgroup" + bytes((0,)))

    def test_directory_bound_read_only_cgroup_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="ge04-cgroup-view-") as temp:
            base = Path(temp) / "leaf"
            base.mkdir()
            fixtures = {
                "cgroup.procs": b"17\n",
                "cgroup.events": b"populated 1\n",
                "cgroup.subtree_control": b"cpu memory pids\n",
            }
            for filename, data in fixtures.items():
                (base / filename).write_bytes(data)
            info = base.stat()
            binding = (info.st_dev, info.st_ino)
            self.assertEqual(read_bound_cgroup_snapshot(base, binding), fixtures)
            with self.assertRaises(ValueError):
                read_bound_cgroup_snapshot(base, (binding[0], binding[1] + 1))
            (base / "cgroup.events").unlink()
            (base / "cgroup.events").symlink_to(base / "cgroup.procs")
            with self.assertRaises(OSError):
                read_bound_cgroup_snapshot(base, binding)
            (base / "cgroup.events").unlink()
            (base / "cgroup.events").write_bytes(fixtures["cgroup.events"])
            alias = Path(temp) / "alias"
            alias.symlink_to(base, target_is_directory=True)
            with self.assertRaises(OSError):
                read_bound_cgroup_snapshot(alias, binding)
            (base / "cgroup.events").write_bytes(b"populated 2\n")
            with self.assertRaises(ValueError):
                read_bound_cgroup_snapshot(base, binding)

    def test_bound_cgroup_ancestry_and_substitution_refusal(self):
        with tempfile.TemporaryDirectory(prefix="ge04-ancestry-") as temp:
            root = Path(temp) / "root"
            outer = root / "outer"
            leaf = outer / "leaf"
            leaf.mkdir(parents=True)
            chain = tuple((p.stat().st_dev, p.stat().st_ino)
                          for p in (root, outer, leaf))
            self.assertEqual(
                observe_bound_cgroup_ancestry(root, ("outer", "leaf"), chain), chain)
            for parts in (("outer", "../leaf"), ("outer/leaf",), ("outer", "."),
                          ("outer", "bad name"), ("outer", "leaf", "extra")):
                with self.subTest(parts=parts), self.assertRaises(ValueError):
                    observe_bound_cgroup_ancestry(root, parts, chain)
            mismatched = (chain[0], chain[1],
                          (chain[2][0], chain[2][1] + 1))
            with self.assertRaises(ValueError):
                observe_bound_cgroup_ancestry(root, ("outer", "leaf"), mismatched)
            new_leaf = outer / "new-leaf"
            leaf.rename(new_leaf)
            leaf.symlink_to(new_leaf, target_is_directory=True)
            with self.assertRaises(OSError):
                observe_bound_cgroup_ancestry(root, ("outer", "leaf"), chain)
            leaf.unlink()
            leaf.mkdir()
            with self.assertRaises(ValueError):
                observe_bound_cgroup_ancestry(root, ("outer", "leaf"), chain)

    def test_external_cgroup_binding_requires_exact_independent_fields(self):
        record = {
            "invocation": "a" * 32,
            "unit": "ge04-r1b2-view-qualification.service",
            "mountId": 42, "mountDevice": "0:27", "mountRoot": "/",
            "keeperPid": 101, "keeperTicks": 123456,
            "ancestry": ((1, 5), (1, 6), (1, 7)),
        }
        self.assertTrue(validate_external_cgroup_binding(record, record.copy()))
        mutations = {
            "invocation": "b" * 32, "unit": "other.service",
            "mountId": 43, "mountDevice": "0:28", "mountRoot": "/nested",
            "keeperPid": 102, "keeperTicks": 123457,
            "ancestry": ((1, 5), (1, 6), (1, 8)),
        }
        for field, replacement in mutations.items():
            changed = {**record, field: replacement}
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_external_cgroup_binding(record, changed)
        for changed in ({**record, "mountId": True},
                        {**record, "keeperPid": 0},
                        {**record, "invocation": "A" * 32},
                        {**record, "ancestry": ((1, 5), (1, 6))},
                        {key: value for key, value in record.items() if key != "unit"},
                        {**record, "authorized": True}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_external_cgroup_binding(record, changed)

    def test_all_closed_modes_terminal_and_crash_quarantine(self):
        def ev(phase, second=False):
            if phase in ("INTENT", "EMPTY"):
                return f"EV {phase} 0 0 0 0\n".encode()
            return (f"EV {phase} 17 123 23 456\n" if second else
                    f"EV {phase} 17 123 0 0\n").encode()
        full = ("INTENT", "PRE_NAMESPACE", "PINNED", "ENABLED",
                "PRE_JOIN", "READY", "EMPTY")
        clean = {
            "outerMembers": b"", "launcherMembers": b"",
            "payloadMembers": b"", "outerPopulated": 0,
            "launcherPopulated": 0, "payloadPopulated": 0,
            "originalBindingIntact": True,
        }
        cases = (
            ("run", full, b"RESULT code=0 reason=COMPLETED clean=1\n"),
            ("recover", ("EMPTY",), b"RESULT code=0 reason=RECOVERED clean=1\n"),
            ("sweep-empty", (), b"RESULT code=0 reason=EMPTY_SWEEP clean=1\n"),
            ("fail-mount", full[:2] + ("EMPTY",),
             b"RESULT code=77 reason=MOUNT_INJECTED clean=1\n"),
            ("fail-enable", full[:3] + ("EMPTY",),
             b"RESULT code=77 reason=ENABLE_EBADF clean=1\n"),
        )
        for mode, phases, result in cases:
            events = [ev(phase, phase in ("PRE_JOIN", "READY")) for phase in phases]
            with self.subTest(mode=mode):
                self.assertEqual(evaluate_closed_qualification_transcript(
                    mode, events, result_raw=result, cleanup=clean),
                    "LOCAL_CONTRACT_ONLY")
                for bad in ({**clean, "originalBindingIntact": False},
                            {**clean, "outerMembers": b"17\n"},
                            {**clean, "payloadPopulated": 1},
                            {**clean, "outerMembers": b"17"}):
                    with self.assertRaises(ValueError):
                        evaluate_closed_qualification_transcript(
                            mode, events, result_raw=result, cleanup=bad)
                with self.assertRaises(ValueError):
                    evaluate_closed_qualification_transcript(
                        mode, events, result_raw=b"RESULT code=0 reason=COMPLETED clean=0\n",
                        cleanup=clean)
        for mode, phases in (
            ("crash-pre-namespace", full[:2]),
            ("crash-pinned", full[:3]),
            ("crash-ready", full[:6]),
        ):
            events = [ev(phase, phase in ("PRE_JOIN", "READY")) for phase in phases]
            with self.subTest(mode=mode):
                self.assertEqual(evaluate_closed_qualification_transcript(
                    mode, events, exit_status=88), "QUARANTINE_PENDING_RECOVERY")
                for exit_status in (0, 77, 89, True):
                    with self.assertRaises(ValueError):
                        evaluate_closed_qualification_transcript(
                            mode, events, exit_status=exit_status)
                with self.assertRaises(ValueError):
                    evaluate_closed_qualification_transcript(
                        mode, events, exit_status=88, cleanup=clean)

    def test_transcript_refuses_extra_missing_and_diagnostic_only_cleanup(self):
        events = (
            b"EV INTENT 0 0 0 0\n",
            b"EV PRE_NAMESPACE 17 123 0 0\n",
            b"EV PINNED 17 123 0 0\n",
            b"EV ENABLED 17 123 0 0\n",
            b"EV PRE_JOIN 17 123 23 456\n",
            b"EV READY 17 123 23 456\n",
            b"EV EMPTY 0 0 0 0\n",
        )
        clean = {
            "outerMembers": b"", "launcherMembers": b"", "payloadMembers": b"",
            "outerPopulated": 0, "launcherPopulated": 0,
            "payloadPopulated": 0, "originalBindingIntact": True,
        }
        result = b"RESULT code=0 reason=COMPLETED clean=1\n"
        for bad_events in (events[:-1], events + events[-1:],
                           events[:3] + events[4:],
                           events[:4] + (b"EV PRE_JOIN 17 123 24 456\n",) + events[5:],
                           (b"EV DENIED 0 0 0 0\n",), [b"a" * 257]):
            with self.subTest(events=bad_events), self.assertRaises(ValueError):
                evaluate_closed_qualification_transcript(
                    "run", bad_events, result_raw=result, cleanup=clean)
        with self.assertRaises(ValueError):
            evaluate_closed_qualification_transcript(
                "run", events, result_raw=result, cleanup=None)
        with self.assertRaises(ValueError):
            evaluate_closed_qualification_transcript(
                "run", events, result_raw=result, cleanup={**clean, "extra": True})

    def test_live_entry_refuses(self):
        with self.assertRaises(RuntimeError):
            root_qualification_refused()


@unittest.skipIf(os.geteuid() == 0, "Never execute local checkout build as root")
class LocalNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or not shutil.which("cc"):
            raise unittest.SkipTest("Linux compiler unavailable")
        temporary = tempfile.TemporaryDirectory(prefix="ge04-view-local-")
        cls.addClassCleanup(temporary.cleanup)
        cls.binary = Path(temporary.name) / "probe"
        subprocess.run(["cc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                        "-fanalyzer", "-o", str(cls.binary),
                        str(ROOT / "native/ge04/cgroup-runtime-view-qualification.c")],
                       check=True, capture_output=True, timeout=30)

    def test_invalid_arguments(self):
        for args in ([], ["other"], ["run", "extra"], ["recover", "anything"]):
            with self.subTest(args=args):
                result = subprocess.run([str(self.binary), *args], capture_output=True,
                                        timeout=5)
                self.assertEqual(result.returncode, 64)
                self.assertEqual(result.stdout, b"")

    def test_unprivileged_refusal(self):
        for mode in ("run", "recover", "sweep-empty"):
            with self.subTest(mode=mode):
                result = subprocess.run([str(self.binary), mode], capture_output=True,
                                        timeout=5)
                self.assertEqual(result.returncode, 77)
                self.assertEqual(result.stdout, b"")


if __name__ == "__main__":
    if os.geteuid() == 0 or os.environ.get("ALIX_GE04_PRIVILEGED_QUALIFICATION"):
        root_qualification_refused()
    unittest.main()
