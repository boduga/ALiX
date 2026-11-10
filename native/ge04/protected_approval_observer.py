"""GE-04 fixed root-owned approval corroboration, read-only and unqualified.

This reader checks the original C fixture's approval.v1 against externally
provided expected invocation/parent identity, from exact root-only paths.
It never mints original intent, proves unit birth, writes or ACKs.
"""
import os
import re
import stat
import sys
from types import MappingProxyType

WORK_COMPONENTS = ("run", "ge04-view-qualification")
PARENT_COMPONENTS = ("sys", "fs", "cgroup", "system.slice",
                     "ge04-r1b2-view-qualification.service")
APPROVAL = re.compile(rb"GE04VA1 ([0-9a-f]{32}) ([1-9][0-9]{0,19}) ([1-9][0-9]{0,19})\n")
MAX_U64 = 2**64 - 1


def _safe_dir(fd, exact=False):
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
            or (info.st_mode & 0o022)
            or (exact and (info.st_mode & 0o7777) != 0o700)):
        raise ValueError("Unsafe root-owned directory custody")
    return info


def _directory_chain(parts, exact_last=False, root_fd=None):
    """Walk no-symlink directory components from a trusted absolute root."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open("/", flags) if root_fd is None else os.dup(root_fd)
    try:
        _safe_dir(fd)
        for i, part in enumerate(parts):
            if (type(part) is not str or not part or part in (".", "..")
                    or "/" in part):
                raise ValueError("Unsafe fixed approval path")
            child = os.open(part, flags, dir_fd=fd)
            try:
                _safe_dir(child, exact=exact_last and i == len(parts) - 1)
            except BaseException:
                os.close(child)
                raise
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _protected_file(directory, name, mode, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC |
                 os.O_NONBLOCK, dir_fd=directory)
    try:
        first = os.fstat(fd)
        if (not stat.S_ISREG(first.st_mode)
                or first.st_uid != 0 or first.st_gid != 0
                or first.st_nlink != 1
                or (first.st_mode & 0o7777) != mode
                or not 0 <= first.st_size <= limit):
            raise ValueError("Unsafe original approval file")
        raw = bytearray()
        while len(raw) <= limit:
            chunk = os.read(fd, min(128, limit + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        second = os.fstat(fd)
        entry = os.stat(name, dir_fd=directory, follow_symlinks=False)
        if (len(raw) > limit or len(raw) != first.st_size
                or (first.st_dev, first.st_ino, first.st_size,
                    first.st_mtime_ns, first.st_ctime_ns) !=
                   (second.st_dev, second.st_ino, second.st_size,
                    second.st_mtime_ns, second.st_ctime_ns)
                or (first.st_dev, first.st_ino) != (entry.st_dev, entry.st_ino)):
            raise ValueError("Original approval changed during read")
        return bytes(raw), (first.st_dev, first.st_ino)
    finally:
        os.close(fd)


def corroborate_existing_approval(original):
    """Refuse unless existing root-owned approval and exact parent agree.

    Current files do not independently prove they existed before unit birth.
    The original dictionary and runtime's source are not authenticated here.
    """
    if sys.platform != "linux" or type(original) is not dict:
        raise ValueError("Linux original approval request required")
    invocation = original.get("invocation")
    ancestry = original.get("ancestry")
    if (type(invocation) is not str
            or re.fullmatch(r"[0-9a-f]{32}", invocation) is None
            or type(ancestry) is not tuple or len(ancestry) != 3
            or any(type(pair) is not tuple or len(pair) != 2 or
                   any(type(i) is not int or i <= 0 for i in pair)
                   for pair in ancestry)):
        raise ValueError("Unbound original approval claims")
    work = _directory_chain(WORK_COMPONENTS, exact_last=True)
    try:
        # The live C fixture also requires a private zero-byte root lock.
        lock, lock_id = _protected_file(work, ".lock", 0o600, 0)
        if lock != b"":
            raise ValueError("Unexpected original lock bytes")
        raw, approval_id = _protected_file(work, "approval.v1", 0o600, 256)
        match = APPROVAL.fullmatch(raw)
        if match is None:
            raise ValueError("Malformed canonical original approval")
        observed_invocation = match.group(1).decode("ascii")
        dev, ino = int(match.group(2)), int(match.group(3))
        if (dev > MAX_U64 or ino > MAX_U64
                or raw != (f"GE04VA1 {observed_invocation} {dev} {ino}\n").encode()
                or observed_invocation != invocation):
            raise ValueError("Original approval invocation mismatch")
        parent = _directory_chain(PARENT_COMPONENTS)
        try:
            info = _safe_dir(parent)
            if ((info.st_dev, info.st_ino) != (dev, ino)
                    or (dev, ino) != ancestry[-1]):
                raise ValueError("Original cgroup parent was substituted")
            # Recheck paths, not merely the already opened directory FDs.
            second_work = _directory_chain(WORK_COMPONENTS, exact_last=True)
            second_parent = -1
            try:
                second_parent = _directory_chain(PARENT_COMPONENTS)
                if ((os.fstat(second_work).st_dev, os.fstat(second_work).st_ino) !=
                    (os.fstat(work).st_dev, os.fstat(work).st_ino)
                    or (os.fstat(second_parent).st_dev, os.fstat(second_parent).st_ino) !=
                       (info.st_dev, info.st_ino)):
                    raise ValueError("Original approval directory path replaced")
            finally:
                if second_parent >= 0:
                    os.close(second_parent)
                os.close(second_work)
            # Re-read the original approval and lock after walking the parent.
            if (_protected_file(work, "approval.v1", 0o600, 256) !=
                    (raw, approval_id)
                    or _protected_file(work, ".lock", 0o600, 0)[1] != lock_id):
                raise ValueError("Original approval changed across parent sample")
            return MappingProxyType({
                "status": "UNQUALIFIED_ORIGINAL_APPROVAL_CORRELATION",
                "invocation": observed_invocation,
                "parentIdentity": (dev, ino),
                "approvalIdentity": approval_id,
            })
        finally:
            os.close(parent)
    finally:
        os.close(work)
