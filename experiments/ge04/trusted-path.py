#!/usr/bin/env python3
"""Descriptor-based Linux absolute path walk for GE04 isolated prototypes."""
import os
from pathlib import Path
import stat


def open_trusted_directory(path: Path, owner_uid: int = 0) -> int:
    """Open from / using O_NOFOLLOW at every component; caller closes returned fd.

    Every component must be owned by owner_uid, not group/other writable.
    This deliberately rejects /tmp and any untrusted ancestor.
    """
    raw = os.fspath(path)
    if (not raw.startswith('/') or chr(0) in raw or
            any(part in ('', '.', '..') for part in raw.split('/')[1:])):
        raise ValueError('trusted path must be canonical absolute without dot or empty components')
    path = Path(raw)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        for part in ('/', *path.parts[1:]):
            if part != '/':
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            metadata = os.fstat(fd)
            if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or
                    metadata.st_mode & 0o022):
                raise PermissionError('untrusted path ancestor: ' + part)
        return fd
    except BaseException:
        os.close(fd)
        raise
