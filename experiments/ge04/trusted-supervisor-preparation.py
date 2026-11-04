#!/usr/bin/env python3
"""GE04 read-only trusted preparation composition. NO execution or admission.

This function returns an inert sealed helper FD for inspection only. An empty
or deny-only ledger is NOT an admission grant or permission to run the FD.
"""
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path


def _load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare(config: Path, release: Path, floor: Path, evidence: Path,
            owner_uid: int = 0) -> tuple[int, str, int]:
    """Caller owns returned FD and must close it. Test paths/UID are not trusted."""
    if os.name != 'posix' or not hasattr(os, 'memfd_create'):
        raise RuntimeError('GE04 requires Linux sealed memfd')
    for root in (config, release, floor, evidence):
        if not Path(root).is_absolute():
            raise PermissionError('GE04 preparation paths must be absolute')
    inventory, attempts = _load('supervisor-ledger-audit').audit(evidence, owner_uid)
    if inventory not in ('DENY_ONLY', 'NOT_AUTHORIZED_ONLY') or attempts:
        # Never infer admission from the ledger, including deny-only records.
        raise PermissionError('GE04 supervisor ledger not empty or uncertain')
    digest, verified, sequence = _load('trusted-release-verification').verify(
        config, release, owner_uid, floor_path=floor, return_verified_bytes=True)
    if type(sequence) is not int or sequence < 0:
        raise PermissionError('GE04 requires verified signed release sequence')
    fd = os.memfd_create('ge04-inert-verified-snapshot', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        view = memoryview(verified)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise OSError('GE04 short sealed snapshot write')
            view = view[count:]
        os.lseek(fd, 0, os.SEEK_SET)
        computed = hashlib.sha256()
        while chunk := os.read(fd, 65536):
            computed.update(chunk)
        if computed.hexdigest() != digest:
            raise PermissionError('GE04 sealed snapshot digest mismatch')
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
        if fcntl.fcntl(fd, fcntl.F_GET_SEALS) & seals != seals:
            raise PermissionError('GE04 incomplete snapshot seals')
        # Recheck inventory after copying: change => fail closed, never launch.
        after, after_attempts = _load('supervisor-ledger-audit').audit(evidence, owner_uid)
        if after != inventory or after_attempts != attempts:
            raise PermissionError('GE04 evidence inventory changed during preparation')
        return fd, digest, sequence
    except BaseException:
        os.close(fd)
        raise
