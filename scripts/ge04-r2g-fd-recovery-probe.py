"""GE-04-R2G read-only, descriptor-relative kernel evidence probe.

Qualification only. Never authorizes recovery, clears a ledger, releases
custody, mutates cgroups, or launches a worker. No privileged verifier exists.
"""
import json
import os
import stat

_ROOT = "/sys/fs/cgroup"
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
_FILE_FLAGS = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW


def _components(relative):
    if not isinstance(relative, str) or not relative or "\0" in relative:
        raise ValueError("invalid cgroup leaf")
    parts = relative.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise ValueError("invalid cgroup component")
    return parts


def _open_leaf(root, parts):
    descriptors = []
    try:
        fd = os.open(root, _DIR_FLAGS)
        descriptors.append(fd)
        for part in parts:
            fd = os.open(part, _DIR_FLAGS, dir_fd=fd)
            descriptors.append(fd)
        return descriptors
    except BaseException:
        for handle in reversed(descriptors):
            os.close(handle)
        raise


def _read_relative(dir_fd, filename):
    fd = os.open(filename, _FILE_FLAGS, dir_fd=dir_fd)
    try:
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            return stream.read(8192)
    except BaseException:
        # fdopen closes on context exit or failed setup only when constructed.
        raise


def _identity(fd):
    s = os.fstat(fd)
    return (s.st_dev, s.st_ino, s.st_uid, s.st_mode)


def _start_ticks(value):
    end = value.rfind(")")
    if end < 0 or value[end + 1:end + 2] != " ":
        return None
    parts = value[end + 2:].split()
    return parts[19] if len(parts) >= 20 and parts[19].isdigit() else None


def _populated(value):
    lines = [line.split() for line in value.splitlines()]
    fields = [p[1] for p in lines if len(p) == 2 and p[0] == "populated"]
    return fields[0] if len(fields) == 1 and fields[0] in ("0", "1") else None


def probe(relative, pid, recorded_ticks, expected_identity, *, root=_ROOT):
    """Observe pinned leaf & /proc process; always return BLOCKED.

    expected_identity must come from a trusted independent provisioner, NOT
    from this call or a worker. Alternate root is for test fixtures only.
    """
    parts = _components(relative)
    if not isinstance(pid, int) or isinstance(pid, bool) or pid < 2:
        raise ValueError("invalid pid")
    if not isinstance(recorded_ticks, str) or not recorded_ticks.isdecimal():
        raise ValueError("invalid start ticks")
    if not isinstance(expected_identity, tuple) or len(expected_identity) != 2:
        raise ValueError("missing independent expected cgroup identity")
    result = {"status": "blocked", "process": "unknown",
              "populated": "unknown", "leaf_identity_stable": False,
              "matches_expected_leaf": False,
              "reasons": ["independent containment and custody proof missing"]}
    handles = []
    try:
        handles = _open_leaf(root, parts)
        leaf_fd = handles[-1]
        before = _identity(leaf_fd)
        result["matches_expected_leaf"] = before[:2] == expected_identity
        if before[2] != 0 or not stat.S_ISDIR(before[3]):
            result["reasons"].append("cgroup leaf not root owned directory")
        try:
            value = _read_relative(leaf_fd, "cgroup.events")
            pop = _populated(value)
            if pop is not None:
                result["populated"] = "yes" if pop == "1" else "no"
        except OSError:
            result["reasons"].append("unreadable cgroup events")
        try:
            proc_handles = _open_leaf("/proc", [str(pid)])
            try:
                first = _start_ticks(_read_relative(proc_handles[-1], "stat"))
                second = _start_ticks(_read_relative(proc_handles[-1], "stat"))
                if first is not None and first == second:
                    result["process"] = "matching" if first == recorded_ticks else "different"
            finally:
                for h in reversed(proc_handles):
                    os.close(h)
        except FileNotFoundError:
            result["process"] = "absent"
        except OSError:
            result["reasons"].append("unreadable process identity")
        after = _identity(leaf_fd)
        result["leaf_identity_stable"] = before == after
        # A second descriptor walk detects simple rename/symlink replacement.
        # It does not eliminate all interleavings or prove ownership authority.
        try:
            again = _open_leaf(root, parts)
            try:
                result["leaf_identity_stable"] &= (_identity(again[-1]) == before)
            finally:
                for h in reversed(again):
                    os.close(h)
        except OSError:
            result["leaf_identity_stable"] = False
    except OSError:
        result["reasons"].append("cgroup leaf inaccessible or replaced")
    finally:
        for h in reversed(handles):
            os.close(h)
    if not result["leaf_identity_stable"]:
        result["reasons"].append("cgroup descriptor/path identity changed or unavailable")
    if not result["matches_expected_leaf"]:
        result["reasons"].append("independent cgroup identity mismatch")
    if result["process"] in ("matching", "unknown"):
        result["reasons"].append("recorded process still present or unverified")
    if result["populated"] != "no":
        result["reasons"].append("cgroup populated or unreadable")
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Qualification-only read-only cgroup observer")
    parser.add_argument("leaf_relative_to_cgroup_root")
    parser.add_argument("pid", type=int)
    parser.add_argument("start_ticks")
    parser.add_argument("expected_dev", type=int)
    parser.add_argument("expected_ino", type=int)
    args = parser.parse_args()
    print(json.dumps(probe(args.leaf_relative_to_cgroup_root,
                           args.pid, args.start_ticks,
                           (args.expected_dev, args.expected_ino)), sort_keys=True))
