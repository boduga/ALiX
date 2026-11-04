#!/usr/bin/env python3
"""SUP-15 experimental fixture provisioning and delegated-FD evidence.

Never a production trust root. Successful outputs are UNTRUSTED observations.
"""
import os
from pathlib import Path
import stat

SECRET_NAME = 'coordinator.fixture.key'


def read_fixture_key(directory: Path, owner_uid: int):
    """Directory is a caller-supplied test location, not an ALiX role anchor."""
    if type(owner_uid) is not int or owner_uid < 0:
        raise ValueError('invalid expected test UID')
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        ds = os.fstat(fd)
        if not stat.S_ISDIR(ds.st_mode) or ds.st_uid != owner_uid or ds.st_mode & 0o077:
            raise PermissionError('unprotected fixture directory')
        keyfd = os.open(SECRET_NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
        try:
            st = os.fstat(keyfd)
            if (not stat.S_ISREG(st.st_mode) or st.st_uid != owner_uid or
                    st.st_mode & 0o077 or st.st_nlink != 1 or st.st_size != 32):
                raise PermissionError('unprotected fixture secret')
            key = os.read(keyfd, 33)
            if len(key) != 32:
                raise PermissionError('invalid fixture secret size')
            return key
        finally:
            os.close(keyfd)
    finally:
        os.close(fd)


def install_fixture_key(directory: Path):
    """TEST-only create-once fixture. Do not replace an existing credential."""
    key = os.urandom(32)
    fd = os.open(directory / SECRET_NAME, os.O_WRONLY | os.O_CREAT |
                 os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        if os.write(fd, key) != 32:
            raise OSError('short fixture write')
        os.fsync(fd)
    finally:
        os.close(fd)
    dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)
    return 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
