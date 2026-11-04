#!/usr/bin/env python3
"""Experimental descriptor-pinned signed installation verification; no execution."""
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import stat


def read_protected_file(directory_fd: int, name: str, owner_uid: int, max_bytes: int) -> bytes:
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                before.st_mode & 0o222 or before.st_nlink != 1 or before.st_size > max_bytes):
            raise PermissionError('untrusted installation file: ' + name)
        data = bytearray()
        while len(data) <= max_bytes:
            chunk = os.read(fd, max_bytes + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        if len(data) > max_bytes or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise PermissionError('installation file changed during read')
        return bytes(data)
    finally:
        os.close(fd)


def load_verified_installation(installation: Path, owner_uid: int, expected_release: str,
                               trusted_key_sha256: str) -> tuple[str, bytes]:
    """Key digest must originate independently of installation and worker inputs."""
    if (not isinstance(trusted_key_sha256, str) or len(trusted_key_sha256) != 64 or
            any(c not in '0123456789abcdef' for c in trusted_key_sha256)):
        raise ValueError('invalid pinned public-key digest')
    directory_fd = os.open(installation, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        directory = os.fstat(directory_fd)
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != owner_uid or
                directory.st_mode & 0o022):
            raise PermissionError('untrusted installation directory')
        public_key = read_protected_file(directory_fd, 'trusted.pub', owner_uid, 32)
        if hashlib.sha256(public_key).hexdigest() != trusted_key_sha256:
            raise PermissionError('installed trust anchor does not match independently pinned digest')
        manifest = read_protected_file(directory_fd, 'manifest.json', owner_uid, 4096)
        signature = read_protected_file(directory_fd, 'manifest.sig', owner_uid, 64)
        helper = read_protected_file(directory_fd, 'helper', owner_uid, 16 * 1024 * 1024)
        spec = importlib.util.spec_from_file_location('ge04_signed_release', Path(__file__).with_name('signed-release.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        digest = module.verify_release(manifest, signature, public_key, helper, expected_release)
        return digest, helper
    finally:
        os.close(directory_fd)


def verify_installation(installation: Path, owner_uid: int, expected_release: str,
                        trusted_key_sha256: str) -> str:
    digest, _ = load_verified_installation(installation, owner_uid, expected_release, trusted_key_sha256)
    return digest


def prepare_verified_sealed_helper(installation: Path, owner_uid: int, expected_release: str,
                                   trusted_key_sha256: str) -> tuple[int, str]:
    """Return an owned sealed memfd of the exact signed bytes; no execution/admission.

    Caller MUST close fd. The key digest and release must be independently trusted.
    This is an experimental unprivileged API, not a production trust boundary.
    """
    if not hasattr(os, 'memfd_create') or not hasattr(os, 'MFD_ALLOW_SEALING'):
        raise RuntimeError('Linux sealed memfd unavailable')
    digest, helper = load_verified_installation(installation, owner_uid, expected_release, trusted_key_sha256)
    fd = os.memfd_create('ge04-signed-helper', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    try:
        remaining = memoryview(helper)
        while remaining:
            count = os.write(fd, remaining)
            if count <= 0:
                raise OSError('short sealed-helper write')
            remaining = remaining[count:]
        os.lseek(fd, 0, os.SEEK_SET)
        hasher = hashlib.sha256()
        while chunk := os.read(fd, 65536):
            hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise PermissionError('verified signed bytes disagree with sealed copy')
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
        if fcntl.fcntl(fd, fcntl.F_GET_SEALS) & seals != seals:
            raise PermissionError('incomplete signed helper seals')
        return fd, digest
    except BaseException:
        os.close(fd)
        raise
