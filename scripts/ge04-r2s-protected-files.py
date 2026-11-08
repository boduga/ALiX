"""GE-04 R2S qualification-only, descriptor-relative trust-file opener.

Linux-only. Root-owned ancestry and leaf are pinned through O_NOFOLLOW dirfd
walk; this reduces symlink/path substitution but does not protect a compromised
root principal, key material held in process memory, or an independent floor.
"""
from __future__ import annotations

import os
from pathlib import PurePosixPath
import stat

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC


def _require_directory(fd: int, owner_uid: int) -> None:
    st = os.fstat(fd)
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != owner_uid
            or stat.S_IMODE(st.st_mode) & 0o022):
        raise PermissionError("untrusted trust-file parent directory")


def _require_file(fd: int, owner_uid: int, maximum: int, private: bool) -> None:
    st = os.fstat(fd)
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != owner_uid
            or st.st_nlink != 1 or stat.S_IMODE(st.st_mode) & 0o022
            or st.st_size < 1 or st.st_size > maximum):
        raise PermissionError("untrusted trust-file leaf")
    mode = stat.S_IMODE(st.st_mode)
    if private and not (mode == 0o600 or
                        (mode == 0o640 and st.st_gid == os.getegid())):
        raise PermissionError("unsafe private key mode")


def open_protected_fd(path: str, *, maximum: int, owner_uid: int = 0,
                      private: bool = False) -> int:
    """Return pinned regular-file descriptor; caller must close.

    owner_uid override exists for isolated test fixtures only; never call with
    a non-root UID for provisioned trust configuration.
    """
    if (type(path) is not str or not path.startswith("/")
            or "//" in path or "\\0" in path or
            any(segment in (".", "..") for segment in path.split("/"))
            or not 1 <= maximum <= 1_048_576):
        raise ValueError("invalid protected file request")
    parts = PurePosixPath(path).parts
    if len(parts) < 3:
        raise ValueError("protected file requires a parent directory")
    directory = os.open("/", DIRECTORY_FLAGS)
    try:
        _require_directory(directory, owner_uid)
        for segment in parts[1:-1]:
            next_fd = os.open(segment, DIRECTORY_FLAGS, dir_fd=directory)
            try:
                _require_directory(next_fd, owner_uid)
            except BaseException:
                os.close(next_fd)
                raise
            os.close(directory)
            directory = next_fd
        leaf = os.open(parts[-1], FILE_FLAGS, dir_fd=directory)
        try:
            _require_file(leaf, owner_uid, maximum, private)
        except BaseException:
            os.close(leaf)
            raise
        return leaf
    finally:
        os.close(directory)


def read_protected(path: str, *, maximum: int, owner_uid: int = 0,
                   private: bool = False) -> bytes:
    fd = open_protected_fd(path, maximum=maximum, owner_uid=owner_uid,
                           private=private)
    try:
        st = os.fstat(fd)
        content = os.read(fd, maximum + 1)
        if len(content) != st.st_size or len(content) > maximum:
            raise ValueError("protected file changed size during read")
        return content
    finally:
        os.close(fd)
