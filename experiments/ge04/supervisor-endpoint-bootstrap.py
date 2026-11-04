#!/usr/bin/env python3
"""GE04 SUP-10 protected AF_UNIX endpoint fixture; no admission or mutation.

The endpoint root and UID are explicit TEST inputs, not a production trust
configuration. Existing socket paths are never unlinked during bootstrap.
"""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import sys

SOCKET_NAME = 'supervisor.sock'


def _open_root(root: Path, owner_uid: int):
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED'):
        raise RuntimeError('Linux SO_PEERCRED required')
    if type(owner_uid) is not int or owner_uid < 0:
        raise ValueError('missing trusted owner UID')
    raw = os.fspath(root)
    if (not raw.startswith('/') or '\x00' in raw or
            any(part in ('', '.', '..') for part in raw.split('/')[1:])):
        raise ValueError('invalid canonical endpoint path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        for component in Path(raw).parts[1:]:
            metadata = os.fstat(fd)
            if (not stat.S_ISDIR(metadata.st_mode) or
                    metadata.st_uid not in (0, owner_uid) or metadata.st_mode & 0o022):
                raise PermissionError('untrusted endpoint ancestor')
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY |
                              os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        metadata = os.fstat(fd)
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or
                metadata.st_mode & 0o077):
            raise PermissionError('endpoint directory must be owner-only')
        return fd
    except BaseException:
        os.close(fd)
        raise


def _socket_identity(fd, owner_uid):
    entry = os.stat(SOCKET_NAME, dir_fd=fd, follow_symlinks=False)
    if (not stat.S_ISSOCK(entry.st_mode) or entry.st_uid != owner_uid or
            entry.st_mode & 0o077):
        raise PermissionError('endpoint identity or permissions mismatch')
    return (entry.st_dev, entry.st_ino)


class Endpoint:
    def __init__(self, listener, directory_fd, identity, owner_uid):
        self.listener = listener
        self.directory_fd = directory_fd
        self.identity = identity
        self.owner_uid = owner_uid

    def check(self):
        if _socket_identity(self.directory_fd, self.owner_uid) != self.identity:
            raise PermissionError('socket endpoint was substituted')
        return 'ENDPOINT_OBSERVED_UNTRUSTED'

    def accept(self):
        self.check()
        connection, _ = self.listener.accept()
        try:
            self.check()
        except BaseException:
            connection.close()
            raise
        return connection

    def close(self):
        # Deliberately retain the endpoint path as an orphan on close/crash.
        # In particular never blindly unlink a substituted socket or symlink.
        self.listener.close()
        os.close(self.directory_fd)


def bootstrap(root: Path, owner_uid: int = 0) -> Endpoint:
    fd = _open_root(root, owner_uid)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        # No overwrite or cleanup of an orphaned endpoint. The test harness
        # verifies existence first; a non-cooperating same-UID actor remains
        # outside this fixture's trust model.
        try:
            os.stat(SOCKET_NAME, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError('endpoint exists: explicit recovery required')
        # Bind beneath the pinned directory descriptor, so ancestor rename
        # cannot silently relocate the target into an attacker-selected path.
        listener.bind('/proc/self/fd/' + str(fd) + '/' + SOCKET_NAME)
        os.chmod(SOCKET_NAME, 0o600, dir_fd=fd, follow_symlinks=False)
        identity = _socket_identity(fd, owner_uid)
        os.fsync(fd)
        listener.listen(4)
        return Endpoint(listener, fd, identity, owner_uid)
    except BaseException:
        listener.close()
        os.close(fd)
        raise
