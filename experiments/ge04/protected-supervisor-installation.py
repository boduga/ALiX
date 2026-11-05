#!/usr/bin/env python3
"""GE-04 root-owned inert supervisor installation and launch fixture.

This is NOT a production service manager. Only root invokes the launcher.
It verifies protected installation files before starting an inert child,
and rejects stale/modified manifests. A root-equivalent attacker can bypass it.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

MODULES = (
    'isolated-uid-supervisor-fixture.py',
    'kernel-bound-datagram-sender.py',
    'sup25-atomic-authority-fixture.py',
    'sup26-inert-terminal-evidence.py',
    'fixture-credential-provisioning.py',
)
MANIFEST = 'installation.json'


def _read_protected(root_fd, name):
    if '/' in name or name in ('', '.', '..'):
        raise PermissionError('unsafe installation entry')
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
    try:
        st = os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or
                st.st_nlink != 1 or st.st_mode & 0o077 or
                not 0 < st.st_size <= 65536):
            raise PermissionError('untrusted installed file')
        raw = bytearray()
        while len(raw) <= 65536:
            chunk = os.read(fd, 65537 - len(raw))
            if not chunk:
                break
            raw.extend(chunk)
        if len(raw) != st.st_size:
            raise PermissionError('installed file changed during read')
        after = os.fstat(fd)
        if (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise PermissionError('installed file changed during inspection')
        return bytes(raw)
    finally:
        os.close(fd)


def verify(installation):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('root Linux installation verifier required')
    root = Path(installation)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('canonical absolute installation path required')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        meta = os.fstat(fd)
        if (not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or
                meta.st_mode & 0o777 != 0o700):
            raise PermissionError('installation directory must be root-only')
        def unique(pairs):
            out = {}
            for key, value in pairs:
                if key in out:
                    raise PermissionError('duplicate installation manifest field')
                out[key] = value
            return out
        manifest = json.loads(_read_protected(fd, MANIFEST), object_pairs_hook=unique)
        if (type(manifest) is not dict or set(manifest) != {'version', 'modules'} or
                type(manifest['version']) is not int or manifest['version'] != 1 or
                type(manifest['modules']) is not dict or
                set(manifest['modules']) != set(MODULES)):
            raise PermissionError('invalid installed manifest')
        for filename in MODULES:
            expected = manifest['modules'][filename]
            if (type(expected) is not str or len(expected) != 64 or
                    any(c not in '0123456789abcdef' for c in expected)):
                raise PermissionError('invalid module digest')
            observed = hashlib.sha256(_read_protected(fd, filename)).hexdigest()
            if observed != expected:
                raise PermissionError('installed module digest mismatch')
        return 'GE04_INSTALLATION_VERIFIED_UNTRUSTED'
    finally:
        os.close(fd)


def launch(installation, private, public, coordinator_pid, coordinator_uid):
    if verify(installation) != 'GE04_INSTALLATION_VERIFIED_UNTRUSTED':
        raise PermissionError('untrusted installation')
    if (type(coordinator_pid) is not int or coordinator_pid <= 0 or
            type(coordinator_uid) is not int or coordinator_uid < 0):
        raise ValueError('invalid coordinator fixture')
    # Re-verification narrows accidental substitution. This is NOT atomic
    # attestation of interpreter execution, and must not be sold as such.
    service = Path(installation) / MODULES[0]
    return subprocess.Popen(
        [sys.executable, '-I', '-B', str(service), str(private), str(public),
         str(coordinator_pid), str(coordinator_uid)],
        close_fds=True, pass_fds=(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
