#!/usr/bin/env python3
"""Inert Q3.2 pathname substitution experiment; no authorization or effects.

Demonstrates the difference between pathname re-open and descriptor pinning.
Only creates temporary synthetic files owned by the executing test user.
"""
import json
import os
from pathlib import Path
import stat
import tempfile

DENIED = 'DENIED GE04_SECURITY_HOLD'


def probe():
    with tempfile.TemporaryDirectory(prefix='alix-q32-path-') as tmp:
        root = Path(tmp)
        trusted = root / 'trusted'
        outside = root / 'outside'
        trusted.mkdir(mode=0o700)
        outside.mkdir(mode=0o700)
        target = trusted / 'policy.json'
        target.write_bytes(b'ORIGINAL_SYNTHETIC')
        replacement = outside / 'policy.json'
        replacement.write_bytes(b'ATTACKER_SYNTHETIC')
        dir_fd = os.open(trusted, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fd = -1
        try:
            fd = os.open('policy.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
            pinned_stat = os.fstat(fd)
            # Simulate an attacker able to rename the path after a check.
            target.rename(trusted / 'original.moved')
            target.symlink_to(replacement)
            naive_follows_replacement = target.read_bytes() == b'ATTACKER_SYNTHETIC'
            pinned_original = (os.pread(fd, 128, 0) == b'ORIGINAL_SYNTHETIC'
                               and stat.S_ISREG(pinned_stat.st_mode)
                               and os.fstat(fd).st_ino == pinned_stat.st_ino)
            nofollow_rejects_symlink = False
            try:
                other = os.open('policy.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
            except OSError:
                nofollow_rejects_symlink = True
            else:
                os.close(other)
            # Rename replacement to a regular file: O_NOFOLLOW is insufficient
            # against same-directory regular-file substitution.
            target.unlink()
            (outside / 'policy.json').rename(target)
            replacement_regular_opened = False
            try:
                other = os.open('policy.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
                try:
                    replacement_regular_opened = os.fstat(other).st_ino != pinned_stat.st_ino
                finally:
                    os.close(other)
            except OSError:
                pass
            return {'gate': 'GE04_Q32_PATH_RACE', 'disposition': 'HOLD',
                    'qualified_independent_custody': False,
                    'naive_path_followed_symlink': naive_follows_replacement,
                    'pinned_fd_preserved_original': pinned_original,
                    'nofollow_rejected_symlink': nofollow_rejects_symlink,
                    'nofollow_did_not_prevent_regular_replacement': replacement_regular_opened,
                    'response': DENIED}
        finally:
            if fd >= 0:
                os.close(fd)
            os.close(dir_fd)


if __name__ == '__main__':
    print(json.dumps(probe(), sort_keys=True))
    raise SystemExit(78)
