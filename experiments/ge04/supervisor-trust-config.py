#!/usr/bin/env python3
"""Experimental independently stored GE04 trust pin. No execution/admission."""
import importlib.util
import json
import os
from pathlib import Path
import stat


def load_trust_config(config_dir: Path, required_owner_uid: int = 0) -> tuple[str, str]:
    """Require an owner-protected config directory separate from release installation.

    The config location must be pinned by the supervisor, never by a worker.
    """
    fd = os.open(config_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        meta = os.fstat(fd)
        if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != required_owner_uid or meta.st_mode & 0o022:
            raise PermissionError('untrusted supervisor config directory')
        spec = importlib.util.spec_from_file_location('ge04_install', Path(__file__).with_name('signed-installation.py'))
        install = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(install)
        raw = install.read_protected_file(fd, 'trust.json', required_owner_uid, 4096)
        record = json.loads(raw)
        if set(record) != {'version', 'trustedKeySha256', 'release'} or record['version'] != 1:
            raise ValueError('invalid supervisor trust configuration')
        digest, release = record['trustedKeySha256'], record['release']
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('invalid configured key pin')
        if not isinstance(release, str) or not release or len(release) > 128:
            raise ValueError('invalid configured release')
        return digest, release
    finally:
        os.close(fd)


def verify_from_trust_config(installation: Path, config_dir: Path, owner_uid: int = 0) -> str:
    """Experimental owner_uid override is test-only; production must hardcode root."""
    if installation.resolve() == config_dir.resolve():
        raise PermissionError('trust configuration must be outside release installation')
    digest, release = load_trust_config(config_dir, owner_uid)
    spec = importlib.util.spec_from_file_location('ge04_install', Path(__file__).with_name('signed-installation.py'))
    install = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(install)
    return install.verify_installation(installation, owner_uid, release, digest)
