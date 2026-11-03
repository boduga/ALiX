#!/usr/bin/env python3
"""GE-04 experimental protected-manifest reader. No authorization or execution."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import stat


def pinned_digest(manifest_dir: Path) -> str:
    """Read digest from owner-only directory; caller must trust its installation."""
    directory = os.open(manifest_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent = os.fstat(directory)
        if parent.st_uid != os.geteuid() or parent.st_mode & 0o077 or not stat.S_ISDIR(parent.st_mode):
            raise PermissionError('manifest directory is not supervisor-owned and private')
        fd = os.open('helper.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid() or
                    before.st_mode & 0o022 or before.st_nlink != 1 or before.st_size > 4096):
                raise PermissionError('manifest inode is untrusted')
            data = bytearray()
            while len(data) <= 4096:
                chunk = os.read(fd, 4097 - len(data))
                if not chunk:
                    break
                data.extend(chunk)
            after = os.fstat(fd)
            if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise PermissionError('manifest changed while reading')
            record = json.loads(data)
            if set(record) != {'version', 'helperSha256'} or record['version'] != 1:
                raise ValueError('invalid manifest schema')
            digest = record['helperSha256']
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                raise ValueError('invalid manifest digest')
            return digest
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def prepare_from_manifest(helper: Path, manifest_dir: Path, evidence_root: Path) -> str:
    spec = importlib.util.spec_from_file_location('ge04_preflight', Path(__file__).with_name('supervisor-preflight.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.prepare(helper, pinned_digest(manifest_dir), evidence_root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--manifest-dir', type=Path, required=True)
    parser.add_argument('--evidence-root', type=Path, required=True)
    args = parser.parse_args()
    print(prepare_from_manifest(args.helper, args.manifest_dir, args.evidence_root))
