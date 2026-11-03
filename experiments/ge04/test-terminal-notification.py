#!/usr/bin/env python3
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

source = Path(__file__).with_name('scoped-owned-create.c')
with tempfile.TemporaryDirectory(prefix='ge04-notify-') as td:
    base = Path(td)
    binary = base / 'helper'
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(binary)], check=True)
    workspace = base / 'workspace'
    (workspace / 'owned').mkdir(parents=True)
    attempt = str(uuid.uuid4())
    read_fd, write_fd = os.pipe()
    env = dict(os.environ, GE04_RECEIPT_FD=str(write_fd), GE04_ATTEMPT_ID=attempt)
    result = subprocess.run([str(binary), str(workspace), 'owned', 'created.txt', 'value'],
                            env=env, pass_fds=(write_fd,), capture_output=True)
    os.close(write_fd)
    receipt = os.read(read_fd, 1024).decode()
    os.close(read_fd)
    assert result.returncode == 0, result.stderr
    assert receipt == f'GE04v1 {attempt} fsynced\n', repr(receipt)
    assert (workspace / 'owned' / 'created.txt').read_text() == 'value'
    invalid = subprocess.run([str(binary), str(workspace), 'owned', 'ambiguous.txt', 'value'],
                             env=dict(os.environ, GE04_ATTEMPT_ID=attempt), capture_output=True)
    assert invalid.returncode != 0
    assert (workspace / 'owned' / 'ambiguous.txt').read_text() == 'value'
    print('GE-04 notification protocol: PASS; post-create error remains ambiguous')
