#!/usr/bin/env python3
"""GE-04 standalone supervisor preflight: no helper execution or mutation.

Caller-supplied digest is a test fixture, NOT trusted provenance or admission.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid

SEALS = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL


def prepare(helper: Path, expected_digest: str, evidence_root: Path) -> str:
    if sys.platform != 'linux' or not hasattr(os, 'memfd_create'):
        raise RuntimeError('Linux memfd sealing required')
    if len(expected_digest) != 64 or any(c not in '0123456789abcdef' for c in expected_digest):
        raise ValueError('invalid pinned SHA-256')
    # Experimental same-UID filesystem checks; NOT an isolation guarantee.
    root_fd = os.open(evidence_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(root_fd)
        if root.st_uid != os.getuid() or root.st_mode & 0o077:
            raise PermissionError('evidence root must be owner-only')
        helper_fd = os.open(helper, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(helper_fd)
            if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o222 or before.st_nlink != 1:
                raise PermissionError('helper must be a non-writable regular single-link inode')
            digest = hashlib.sha256()
            sealed_fd = os.memfd_create('ge04-supervisor-preflight', os.MFD_ALLOW_SEALING)
            try:
                while chunk := os.read(helper_fd, 65536):
                    digest.update(chunk)
                    view = memoryview(chunk)
                    while view:
                        written = os.write(sealed_fd, view)
                        view = view[written:]
                after = os.fstat(helper_fd)
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
                ) or digest.hexdigest() != expected_digest:
                    raise PermissionError('helper identity or pinned digest mismatch')
                os.lseek(sealed_fd, 0, os.SEEK_SET)
                verified = hashlib.sha256()
                while chunk := os.read(sealed_fd, 65536):
                    verified.update(chunk)
                if verified.hexdigest() != expected_digest:
                    raise PermissionError('sealed copy digest mismatch')
                fcntl.fcntl(sealed_fd, fcntl.F_ADD_SEALS, SEALS)
                if fcntl.fcntl(sealed_fd, fcntl.F_GET_SEALS) & SEALS != SEALS:
                    raise PermissionError('incomplete executable seals')
                # No execution or authorization. This ledger is pre-spawn only.
                attempt_id = str(uuid.uuid4())
                record = json.dumps({'version': 1, 'attemptId': attempt_id,
                                     'state': 'pre_spawn', 'helperSha256': expected_digest,
                                     'admission': 'NOT_AUTHORIZED'}, sort_keys=True).encode() + b'\n'
                entry_fd = os.open(attempt_id + '.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                   0o600, dir_fd=root_fd)
                try:
                    remaining = memoryview(record)
                    while remaining:
                        count = os.write(entry_fd, remaining)
                        if count <= 0:
                            raise OSError('short evidence write')
                        remaining = remaining[count:]
                    os.fsync(entry_fd)
                finally:
                    os.close(entry_fd)
                os.fsync(root_fd)
                return attempt_id
            finally:
                os.close(sealed_fd)
        finally:
            os.close(helper_fd)
    finally:
        os.close(root_fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--pinned-sha256', required=True)
    parser.add_argument('--evidence-root', type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.helper, args.pinned_sha256, args.evidence_root))
