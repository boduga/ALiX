#!/usr/bin/env python3
"""Inert descriptor identity experiment. No effect authorization, ever."""
import json
import os
from pathlib import Path
import stat
import tempfile

DENIED = 'DENIED GE04_SECURITY_HOLD'


def identity(fd):
    st = os.fstat(fd)
    return (st.st_dev, st.st_ino, stat.S_IFMT(st.st_mode))


def pinned_match(root_fd, name, expected):
    """Diagnostic identity comparison, not safe general path resolution."""
    if name in ('', '.', '..') or '/' in name or '\x00' in name:
        return False
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
    except OSError:
        return False
    try:
        return stat.S_ISREG(os.fstat(fd).st_mode) and identity(fd) == expected
    finally:
        os.close(fd)


def probe():
    with tempfile.TemporaryDirectory(prefix='alix-q32-target-') as tmp:
        root = Path(tmp)
        target = root / 'target'
        target.write_bytes(b'ORIGINAL')
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        original_fd = os.open('target', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            expected = identity(original_fd)
            initial = pinned_match(root_fd, 'target', expected)
            target.rename(root / 'moved')
            target.write_bytes(b'REPLACEMENT')
            replaced = not pinned_match(root_fd, 'target', expected)
            pinned_original = (identity(original_fd) == expected and
                               os.pread(original_fd, 16, 0) == b'ORIGINAL')
            target.unlink()
            target.symlink_to(root / 'moved')
            symlink_rejected = not pinned_match(root_fd, 'target', expected)
            traversal_rejected = not pinned_match(root_fd, '../target', expected)
            return {'gate': 'GE04_Q32_DESCRIPTOR_TARGET', 'disposition': 'HOLD',
                    'qualified_effect_fence': False, 'initial_identity_matched': initial,
                    'regular_replacement_rejected': replaced,
                    'pinned_original_preserved': pinned_original,
                    'symlink_rejected': symlink_rejected,
                    'traversal_rejected': traversal_rejected, 'response': DENIED}
        finally:
            os.close(original_fd)
            os.close(root_fd)


if __name__ == '__main__':
    print(json.dumps(probe(), sort_keys=True))
    raise SystemExit(78)
