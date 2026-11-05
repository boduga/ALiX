#!/usr/bin/env python3
"""GE-04 pinned native ELF inspection/launch, ROOT-ONLY EXPERIMENT.

Provides pathname-swap-resistant execution of inspected bytes in a fixture.
The expected hash is supplied by the privileged harness, NOT an independently
authenticated release policy. Does not authorize any production execution.
"""
import hashlib
import os
import stat
import subprocess
import sys


def pin_binary(path, expected_digest):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('experimental Linux root boundary only')
    if (type(expected_digest) is not str or len(expected_digest) != 64 or
            any(ch not in '0123456789abcdef' for ch in expected_digest)):
        raise ValueError('invalid expected binary digest')
    if not os.path.isabs(os.fspath(path)):
        raise PermissionError('absolute native fixture path required')
    # A caller-chosen path/hash does not establish signed release identity.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or
                before.st_nlink != 1 or before.st_mode & 0o777 != 0o700 or
                not 0 < before.st_size <= 4 * 1024 * 1024):
            raise PermissionError('untrusted native fixture image')
        digest = hashlib.sha256()
        prefix = os.read(fd, 4)
        if prefix != b'\x7fELF':
            raise PermissionError('native fixture must be ELF')
        digest.update(prefix)
        total = 4
        while True:
            block = os.read(fd, 65536)
            if not block:
                break
            total += len(block)
            if total > 4 * 1024 * 1024:
                raise PermissionError('oversized native fixture')
            digest.update(block)
        after = os.fstat(fd)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size,
                              s.st_mtime_ns, s.st_ctime_ns)
        if total != before.st_size or identity(before) != identity(after):
            raise PermissionError('native image changed while inspected')
        if digest.hexdigest() != expected_digest:
            raise PermissionError('native image digest mismatch')
        return fd
    except BaseException:
        os.close(fd)
        raise


def run_pinned(fd, pinned_directory_fd):
    """Execute same inspected FD, not a re-resolved pathname.

    Caller must hold the lifecycle exclusion lock and close the returned FD.
    /proc, interpreter/dynamic-loader, mount and host-root provenance remain
    outside this demonstration's qualified security boundary.
    """
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0:
        raise PermissionError('invalid pinned image')
    parent = os.fstat(pinned_directory_fd)
    if not stat.S_ISDIR(parent.st_mode):
        raise PermissionError('invalid pinned directory')
    return subprocess.run(
        ['/proc/self/fd/' + str(fd), 'GE04-INERT-FIXTURE-V1',
         str(pinned_directory_fd)],
        pass_fds=(fd, pinned_directory_fd), close_fds=True,
        env={'PATH': '/usr/bin:/bin'}, capture_output=True,
        text=True, timeout=8, check=False)
