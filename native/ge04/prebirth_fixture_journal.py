"""GE-04 disposable unprivileged PREBIRTH journal fixture; NEVER root issuer.

One-shot exclusive journal publication only. This models crash uncertainty
without creating a systemd unit, constructing approval, resuming on restart or
authorizing a worker. Inputs and callbacks are not authenticated.
"""
import json
import os
import stat
import sys
from types import MappingProxyType

from prebirth_issuance_contract import canonical_prebirth

FILENAME = "prebirth-intent.v1"
MAX_RECORD = 1024


def _fixture_directory(fd):
    info = os.fstat(fd)
    if (sys.platform != "linux" or os.geteuid() == 0
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid()
            or (info.st_mode & 0o7777) != 0o700):
        raise PermissionError("Unprivileged private fixture directory required")
    return (info.st_dev, info.st_ino)


def _read_exact_file(directory):
    fd = os.open(FILENAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                 os.O_CLOEXEC, dir_fd=directory)
    try:
        first = os.fstat(fd)
        if (not stat.S_ISREG(first.st_mode) or first.st_nlink != 1
                or first.st_uid != os.geteuid()
                or (first.st_mode & 0o7777) != 0o600
                or not 0 < first.st_size <= MAX_RECORD):
            raise ValueError("Unsafe fixture journal custody")
        raw = bytearray()
        while len(raw) <= MAX_RECORD:
            chunk = os.read(fd, min(256, MAX_RECORD + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        second = os.fstat(fd)
        path_now = os.stat(FILENAME, dir_fd=directory, follow_symlinks=False)
        if (len(raw) != first.st_size or len(raw) > MAX_RECORD
                or (first.st_dev, first.st_ino, first.st_ctime_ns,
                    first.st_mtime_ns, first.st_size) !=
                   (second.st_dev, second.st_ino, second.st_ctime_ns,
                    second.st_mtime_ns, second.st_size)
                or (path_now.st_dev, path_now.st_ino) !=
                   (first.st_dev, first.st_ino)):
            raise ValueError("Unstable fixture journal")
        return bytes(raw), (first.st_dev, first.st_ino)
    finally:
        os.close(fd)


def inspect_fixture_journal(directory):
    """Existing journal always means QUARANTINE, never adopted authority."""
    _fixture_directory(directory)
    raw, inode = _read_exact_file(directory)
    try:
        record = json.loads(raw)
        if canonical_prebirth(record) != raw:
            raise ValueError("Noncanonical prebirth journal")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ValueError("Invalid prebirth journal") from exc
    return MappingProxyType({
        "status": "UNQUALIFIED_QUARANTINE_ON_REOPEN",
        "journalIdentity": inode,
        "record": MappingProxyType(record),
    })


def publish_fixture_once(directory, prebirth, absent_unit_probe, fault=None):
    """Persist exclusive test bytes; no unit creation and no recovery.

    Probe and fault callbacks are untrusted local fixtures, not an
    authenticated systemd manager or independent source of authorization.
    """
    if os.geteuid() == 0:
        raise PermissionError("GE-04 SECURITY HOLD: root publisher denied")
    identity = _fixture_directory(directory)
    raw = canonical_prebirth(prebirth)
    if not callable(absent_unit_probe):
        raise ValueError("Absent-unit fixture probe required")
    if fault is not None and not callable(fault):
        raise ValueError("Invalid fault injector")
    try:
        os.stat(FILENAME, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        raise ValueError("Existing prebirth journal: QUARANTINE, no adoption")
    if absent_unit_probe() is not True:
        raise ValueError("Unit absence not demonstrated by test probe")
    fd = os.open(FILENAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    try:
        issued_stat = os.fstat(fd)
        issued_identity = (issued_stat.st_dev, issued_stat.st_ino)
        if os.write(fd, raw) != len(raw):
            raise OSError("Short prebirth intent write")
        if fault:
            fault("after-write")
        os.fsync(fd)
        if fault:
            fault("after-file-fsync")
        stored, stored_identity = _read_exact_file(directory)
        if stored != raw or stored_identity != issued_identity:
            raise ValueError("Original prebirth journal inode changed")
        current = os.fstat(directory)
        if (current.st_dev, current.st_ino) != identity:
            raise ValueError("Fixture journal directory replaced")
        os.fsync(directory)
        if fault:
            fault("after-directory-fsync")
        if absent_unit_probe() is not True:
            raise ValueError("Unit appeared before journal handoff")
        final_raw, final_identity = _read_exact_file(directory)
        if final_raw != raw or final_identity != issued_identity:
            raise ValueError("Original journal changed during final handoff")
        if (os.fstat(directory).st_dev, os.fstat(directory).st_ino) != identity:
            raise ValueError("Journal directory changed during handoff")
        return MappingProxyType({
            "status": "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED",
            "recordBytes": raw,
        })
    finally:
        os.close(fd)
        # Preserve partial files after failure. No cleanup, retry, or adoption.


def publish_observed_fixture_once(directory, prebirth, fault=None):
    """Use genuine read-only systemd absence checks for a user-only fixture.

    This still cannot reserve, lock, or create the unit. It does not grant
    authority: the systemd state may change immediately after the query.
    """
    from systemd_absence_observer import probe_fixed_unit_absence

    def absent():
        result = probe_fixed_unit_absence()
        return result["status"] == "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION"

    return publish_fixture_once(directory, prebirth, absent, fault)
