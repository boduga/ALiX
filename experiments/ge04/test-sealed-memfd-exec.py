#!/usr/bin/env python3
"""GE-04 Linux-only isolated proof: sealed, verified memfd executable.

Not a production launcher, supervisor, receipt, or security qualification.
"""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or not hasattr(os, 'memfd_create'):
    raise SystemExit('Linux memfd_create required')

source = Path(__file__).with_name('scoped-owned-create.c')
with tempfile.TemporaryDirectory(prefix='ge04-memfd-proof-') as temp:
    base = Path(temp)
    binary = base / 'native-helper'
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(binary)], check=True)
    original = binary.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    fd = os.memfd_create('ge04-verified-executable', os.MFD_ALLOW_SEALING)
    try:
        assert os.write(fd, original) == len(original)
        os.lseek(fd, 0, os.SEEK_SET)
        verified = os.read(fd, len(original) + 1)
        assert hashlib.sha256(verified).hexdigest() == digest
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
        assert fcntl.fcntl(fd, fcntl.F_GET_SEALS) & seals == seals
        for operation in ('write', 'truncate'):
            try:
                if operation == 'write':
                    os.pwrite(fd, b'X', 0)
                else:
                    os.ftruncate(fd, 1)
            except OSError:
                pass
            else:
                raise AssertionError('sealed memfd accepted ' + operation)
        workspace = base / 'workspace'
        (workspace / 'owned').mkdir(parents=True)
        # Original pathname is no longer needed: execute only the sealed memfd.
        binary.unlink()
        result = subprocess.run([f'/proc/self/fd/{fd}', str(workspace), 'owned', 'created.txt', 'value'],
                                pass_fds=(fd,), capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr.decode(errors='replace')
        assert (workspace / 'owned' / 'created.txt').read_text() == 'value'
        assert not binary.exists()
        print('GE-04 sealed memfd proof PASS: hash, seals, denied writes, pathname-independent native exec')
    finally:
        os.close(fd)
