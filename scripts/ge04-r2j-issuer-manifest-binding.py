"""GE-04-R2J read-only issuer-to-manifest custody consistency gate.

Qualification-only: verifies multiple OS observations together, never
authenticates a privileged issuer, never confers authority, and never clears
durable ownership or admits workers. A privileged, independently authenticated
IPC boundary and hostile-worker proof remain UNQUALIFIED.
"""
from __future__ import annotations

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat

_HERE = Path(__file__).resolve().parent


def _load_neighbor(filename: str, name: str):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("unavailable qualification module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_CUSTODY = _load_neighbor("ge04-r2i-issuer-custody.py", "_ge04_r2i_custody")
_MANIFEST = _load_neighbor("ge04-r2h-recovery-manifest.py", "_ge04_r2h_manifest")
_READ_ONLY = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
_CLAIM_FIELDS = {"schema", "ownerId", "pid", "uid", "bootId", "startTimeTicks"}


def _read_regular(dir_fd: int, name: str, expected_uid: int):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name) or name.startswith("."):
        raise ValueError("invalid protected filename")
    fd = os.open(name, _READ_ONLY, dir_fd=dir_fd)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != expected_uid
                or before.st_mode & 0o077 or before.st_nlink != 1
                or before.st_size <= 0 or before.st_size > 4096):
            raise PermissionError("untrusted protected file")
        with os.fdopen(os.dup(fd), "rb") as reader:
            contents = reader.read(4097)
        after = os.fstat(fd)
        if (len(contents) != before.st_size
                or (before.st_dev, before.st_ino, before.st_size,
                    before.st_mtime_ns, before.st_ctime_ns) !=
                   (after.st_dev, after.st_ino, after.st_size,
                    after.st_mtime_ns, after.st_ctime_ns)):
            raise ValueError("protected file changed during read")
        # Reject replacement of named file during read, not merely fd stability.
        named = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("protected file name was replaced")
        return json.loads(contents.decode("utf-8"))
    finally:
        os.close(fd)


def _process_generation(pid: int):
    """Read start ticks twice: path-based /proc cannot pin process generation.

    A pidfd-owned privileged verifier remains necessary.
    """
    try:
        raw1 = Path(f"/proc/{pid}/stat").read_text()
        raw2 = Path(f"/proc/{pid}/stat").read_text()
        def parse(raw):
            close = raw.rfind(")")
            if close < 0 or raw[close + 1:close + 2] != " ":
                return None
            parts = raw[close + 2:].split()
            return parts[19] if len(parts) >= 20 and parts[19].isdigit() else None
        first, second = parse(raw1), parse(raw2)
        return first if first and first == second else None
    except OSError:
        return None


def inspect_issuer_manifest_binding(custody_dir: str, manifest_name: str,
                                    recovery_record: dict, expected_relative: str,
                                    expected_issuer_id: str, *,
                                    required_uid: int = 0, boot_id: str | None = None):
    """Read-only multi-source consistency check. Never returns authorization.

    required_uid overrides are strictly for local nonprivileged fixtures.
    expected_issuer_id is a supplied configuration assertion, not proof of a
    privileged trusted principal. A forged same-UID custody is not excluded.
    """
    result = {"status": "blocked", "consistencyChecksPassed": False,
              "issuerGenerationMatches": False, "manifestMatches": False,
              "lockContended": False, "reasons": []}
    reasons = result["reasons"]
    directory_fd = None
    lock_fd = None
    try:
        if not isinstance(expected_issuer_id, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{1,128}", expected_issuer_id):
            raise ValueError("invalid configured issuer")
        if type(required_uid) is not int or required_uid < 0:
            raise ValueError("invalid expected uid")
        directory_fd = _CUSTODY._open_protected_directory(custody_dir, required_uid)
        claim = _read_regular(directory_fd, _CUSTODY.CLAIM_NAME, required_uid)
        if not isinstance(claim, dict) or set(claim) != _CLAIM_FIELDS:
            raise ValueError("unknown issuer claim schema")
        if (claim["schema"] != "ge04-r2i-v2" or claim["ownerId"] != expected_issuer_id
                or type(claim["pid"]) is not int or claim["pid"] < 2
                or type(claim["uid"]) is not int or claim["uid"] != required_uid
                or not isinstance(claim["startTimeTicks"], str)
                or not re.fullmatch(r"[1-9][0-9]*", claim["startTimeTicks"])
                or not isinstance(claim["bootId"], str) or not claim["bootId"]):
            raise ValueError("issuer identity or generation mismatch")
        if boot_id is None:
            with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as reader:
                boot_id = reader.read().strip()
        if claim["bootId"] != boot_id:
            reasons.append("issuer claim bound to previous kernel boot")
        else:
            current = _process_generation(claim["pid"])
            if current == claim["startTimeTicks"]:
                result["issuerGenerationMatches"] = True
            else:
                reasons.append("issuer PID generation absent, reused or unreadable")

        # A contender can establish a lock is held; it CANNOT authenticate
        # which process holds it or that it is a trusted privileged issuer.
        lock_fd = os.open(_CUSTODY.LOCK_NAME, _READ_ONLY, dir_fd=directory_fd)
        _CUSTODY._check_lock(lock_fd, directory_fd, required_uid)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            reasons.append("no exclusive issuer lock currently held")
        except BlockingIOError:
            result["lockContended"] = True

        manifest = _read_regular(directory_fd, manifest_name, required_uid)
        manifest_path = os.path.join(custody_dir, manifest_name)
        checked = _MANIFEST.verify_recovery_manifest(
            manifest_path, recovery_record, expected_relative,
            boot_id=boot_id, required_uid=required_uid)
        if checked.get("manifestVerified") is True:
            result["manifestMatches"] = True
        else:
            reasons.append("durable worker manifest mismatch or untrusted")
        # Confirm the same protected filename is still the same data after
        # the separate R2H path walk. Does not eliminate all rename races.
        if manifest != _read_regular(directory_fd, manifest_name, required_uid):
            reasons.append("manifest changed during verification")

        if (result["issuerGenerationMatches"] and result["lockContended"]
                and result["manifestMatches"] and not reasons):
            result["consistencyChecksPassed"] = True
    except (OSError, ValueError, TypeError, KeyError, _CUSTODY.CustodyDenied) as error:
        reasons.append("issuer-manifest binding unavailable: " + type(error).__name__)
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        if directory_fd is not None:
            os.close(directory_fd)
    reasons.append("privileged issuer authentication and recovery authority unqualified")
    return result
