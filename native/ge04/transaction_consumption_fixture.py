"""GE-04 disposable transaction consumption journal, NON-AUTHORIZING.

A durable *claim of consumption* is written before checking an untrusted
cross-source packet. Any process restart, duplicate, corrupt checkpoint or
partial write is quarantine: never resume or reissue. Root is refused.

This is a user-owned private-directory fixture, NOT original root custody.
A local UID owner can remove/change it, and therefore this DOES NOT enforce
global, protected, or durable production replay prevention.
"""
import hashlib
import json
import os
import stat
import sys
from types import MappingProxyType

from cross_source_birth_reconciliation import reconcile_birth_packet
from prebirth_issuance_contract import canonical_prebirth
from prebirth_fixture_journal import _fixture_directory, _read_exact_file

NAME = "birth-consumption.v1"
_FIELDS = frozenset(("schemaVersion", "prebirthSha256", "attempt", "nonce"))
MAX_SIZE = 256


def _existing_consumption(directory):
    fd = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                 os.O_CLOEXEC, dir_fd=directory)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or (info.st_mode & 0o7777) != 0o600
                or not 0 < info.st_size <= MAX_SIZE):
            raise ValueError("Unsafe existing diagnostic consumption record")
        raw = os.read(fd, MAX_SIZE + 1)
        now = os.fstat(fd)
        path = os.stat(NAME, dir_fd=directory, follow_symlinks=False)
        if (len(raw) != info.st_size
                or (info.st_dev, info.st_ino) != (path.st_dev, path.st_ino)
                or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                    info.st_ctime_ns) !=
                   (now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns,
                    now.st_ctime_ns)):
            raise ValueError("Changed diagnostic consumption record")
        return raw
    finally:
        os.close(fd)


def inspect_consumption_after_restart(directory):
    """Existing checkpoint always quarantines, even if perfectly canonical."""
    _fixture_directory(directory)
    raw = _existing_consumption(directory)
    try:
        claim = json.loads(raw.decode("ascii"))
        if (type(claim) is not dict or frozenset(claim) != _FIELDS
                or claim["schemaVersion"] != 1
                or type(claim["attempt"]) is not int
                or not 0 < claim["attempt"] < 2**63
                or type(claim["nonce"]) is not str or len(claim["nonce"]) != 64
                or type(claim["prebirthSha256"]) is not str
                or len(claim["prebirthSha256"]) != 64
                or raw != (json.dumps(claim, sort_keys=True, separators=(",", ":"))
                           + "\n").encode("ascii")):
            raise ValueError("Malformed diagnostic consumption record")
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ValueError("Incomplete/corrupt consumption: quarantine") from exc
    return MappingProxyType({
        "status": "UNQUALIFIED_QUARANTINE_ON_RESTART",
        "prebirthSha256": claim["prebirthSha256"],
    })


def consume_packet_once(directory, packet, *, fault=None):
    """Claim once, fsync before any reconciliation; failures never roll back.

    The original prebirth file MUST already be present; this never mints one.
    The packet is caller-provided, and even full success is UNQUALIFIED.
    """
    if sys.platform != "linux" or os.geteuid() == 0:
        raise PermissionError("GE-04 SECURITY HOLD: root consumption denied")
    identity = _fixture_directory(directory)
    if type(packet) is not dict or type(fault) not in (type(None),) and not callable(fault):
        raise ValueError("Invalid diagnostic consumption request")
    original_raw, original_inode = _read_exact_file(directory)
    source = canonical_prebirth(packet["prebirth"])
    if source != original_raw:
        raise ValueError("Original journal and packet mismatch")
    claimed = {
        "schemaVersion": 1,
        "prebirthSha256": hashlib.sha256(original_raw).hexdigest(),
        "attempt": packet["prebirth"]["attempt"],
        "nonce": packet["prebirth"]["nonce"],
    }
    raw = (json.dumps(claimed, sort_keys=True, separators=(",", ":"))
           + "\n").encode("ascii")
    if len(raw) > MAX_SIZE:
        raise ValueError("Oversized consumption claim")
    # No up-front existence check: O_EXCL is the only name claim.
    fd = os.open(NAME, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
                 os.O_CLOEXEC | os.O_WRONLY, 0o600, dir_fd=directory)
    try:
        issued = os.fstat(fd)
        issued_id = (issued.st_dev, issued.st_ino)
        if os.write(fd, raw) != len(raw):
            raise ValueError("Partial transaction consumption journal")
        if fault:
            fault("after-write")
        os.fsync(fd)
        if fault:
            fault("after-file-fsync")
        os.fsync(directory)
        if fault:
            fault("after-directory-fsync")
        if _existing_consumption(directory) != raw:
            raise ValueError("Original consumption bytes changed")
        path_info = os.stat(NAME, dir_fd=directory, follow_symlinks=False)
        if (path_info.st_dev, path_info.st_ino) != issued_id:
            raise ValueError("Consumption journal replaced")
        if _read_exact_file(directory) != (original_raw, original_inode):
            raise ValueError("Original prebirth record replaced")
        if (os.fstat(directory).st_dev, os.fstat(directory).st_ino) != identity:
            raise ValueError("Consumption directory replaced")
        result = reconcile_birth_packet(**packet)
        if (result["status"] != "UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION"
                or result["prebirthSha256"] != claimed["prebirthSha256"]
                or canonical_prebirth(packet["prebirth"]) != original_raw):
            raise ValueError("Reconciliation changed original consumed attempt")
        # A forged consistent packet remains UNQUALIFIED.
        if fault:
            fault("after-reconciliation")
        if (_existing_consumption(directory) != raw
                or _read_exact_file(directory) !=
                   (original_raw, original_inode)):
            raise ValueError("Journal changed during reconciliation")
        final = os.stat(NAME, dir_fd=directory, follow_symlinks=False)
        if (final.st_dev, final.st_ino) != issued_id:
            raise ValueError("Consumption record replaced after check")
        return MappingProxyType({
            "status": "UNQUALIFIED_JOURNALED_PACKET_CORRELATION",
            "prebirthSha256": claimed["prebirthSha256"],
            "diagnostic": result,
        })
    finally:
        os.close(fd)
        # Never unlink, retry, repair, adopt, or issue ACK.
