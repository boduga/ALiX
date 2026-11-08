"""GE-04-R2I qualification-only exclusive issuer custody prototype.

This is NOT a privileged authority, policy issuer, or recovery clearance.
An operator must separately provision the protected directory and pre-existing
lock file. A durable claim is intentionally never removed, even after a crash.
No production activation, credential delivery or manifest signing is provided.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import stat

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
CLAIM_NAME = "issuer.claim"
LOCK_NAME = "issuer.lock"


class CustodyDenied(RuntimeError):
    pass


def _open_protected_directory(directory: str, uid: int) -> int:
    if (not isinstance(directory, str) or not directory.startswith("/")
            or "\0" in directory):
        raise CustodyDenied("invalid custody directory")
    parts = directory[1:].split("/")
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise CustodyDenied("invalid custody path component")
    current = os.open("/", DIRECTORY_FLAGS)
    try:
        for part in parts:
            nxt = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
            try:
                info = os.fstat(nxt)
                if info.st_uid not in (0, uid) or info.st_mode & 0o022:
                    raise CustodyDenied("untrusted directory ancestry")
            except BaseException:
                os.close(nxt)
                raise
            os.close(current)
            current = nxt
        leaf = os.fstat(current)
        if leaf.st_uid != uid or leaf.st_mode & 0o077:
            raise CustodyDenied("custody leaf is not exclusively owned")
        return current
    except BaseException:
        os.close(current)
        raise


def _check_lock(fd: int, directory_fd: int, uid: int) -> None:
    info = os.fstat(fd)
    by_path = os.stat(LOCK_NAME, dir_fd=directory_fd, follow_symlinks=False)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid
            or info.st_mode & 0o077 or info.st_nlink != 1
            or info.st_dev != by_path.st_dev or info.st_ino != by_path.st_ino):
        raise CustodyDenied("issuer lock ownership or identity invalid")


class IssuerCustody:
    """Keep lock and directory descriptors open while process holds custody."""

    def __init__(self, directory_fd: int, lock_fd: int, owner_id: str):
        self._directory_fd = directory_fd
        self._lock_fd = lock_fd
        self.owner_id = owner_id

    def close(self) -> None:
        # Releasing flock does NOT authorize takeover: claim remains sticky.
        if self._lock_fd is not None:
            os.close(self._lock_fd)
            self._lock_fd = None
        if self._directory_fd is not None:
            os.close(self._directory_fd)
            self._directory_fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _issuer_process_generation() -> tuple[str, str]:
    """Bind the sticky claim to this boot and process generation, not PID alone."""
    with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as stream:
        boot_id = stream.read().strip()
    with open("/proc/self/stat", encoding="ascii") as stream:
        raw = stream.read()
    end = raw.rfind(")")
    if end < 0 or raw[end + 1:end + 2] != " ":
        raise CustodyDenied("kernel issuer process identity unavailable")
    fields = raw[end + 2:].split()
    if len(fields) < 20 or not fields[19].isdigit() or not boot_id:
        raise CustodyDenied("kernel issuer generation unavailable")
    return boot_id, fields[19]


def claim_issuer_custody(directory: str, owner_id: str, *, required_uid: int = 0) -> IssuerCustody:
    """Atomically claim a pre-provisioned, protected issuer directory.

    required_uid overrides are ONLY for nonprivileged test fixtures.
    Never take over an existing claim, including after process death.
    """
    if os.name != "posix" or not hasattr(fcntl, "flock"):
        raise CustodyDenied("unsupported platform")
    if (not isinstance(owner_id, str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", owner_id)):
        raise CustodyDenied("invalid custody owner")
    if type(required_uid) is not int or required_uid < 0:
        raise CustodyDenied("invalid expected issuer uid")
    if os.geteuid() != required_uid:
        raise CustodyDenied("untrusted issuer effective uid")
    boot_id, start_ticks = _issuer_process_generation()
    try:
        directory_fd = _open_protected_directory(directory, required_uid)
    except OSError as exc:
        raise CustodyDenied("protected issuer directory unavailable") from exc
    lock_fd = None
    try:
        lock_fd = os.open(LOCK_NAME, FILE_FLAGS, dir_fd=directory_fd)
        _check_lock(lock_fd, directory_fd, required_uid)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CustodyDenied("issuer lock already held") from exc
        _check_lock(lock_fd, directory_fd, required_uid)
        # Sticky claim, not a lease. Never create a replacement or delete it.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            claim_fd = os.open(CLAIM_NAME, flags, 0o600, dir_fd=directory_fd)
        except FileExistsError as exc:
            raise CustodyDenied("issuer custody already claimed; manual recovery required") from exc
        # A failed write after O_EXCL deliberately leaves a sticky claim.
        try:
            payload = (json.dumps({"schema": "ge04-r2i-v2", "ownerId": owner_id,
                                   "pid": os.getpid(), "uid": os.geteuid(),
                                   "bootId": boot_id, "startTimeTicks": start_ticks},
                                  separators=(",", ":")) + "\n").encode("ascii")
            while payload:
                written = os.write(claim_fd, payload)
                if written <= 0:
                    raise OSError("short custody claim write")
                payload = payload[written:]
            os.fsync(claim_fd)
        finally:
            os.close(claim_fd)
        os.fsync(directory_fd)
        _check_lock(lock_fd, directory_fd, required_uid)
        return IssuerCustody(directory_fd, lock_fd, owner_id)
    except BaseException:
        if lock_fd is not None:
            os.close(lock_fd)
        os.close(directory_fd)
        raise
