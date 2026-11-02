#!/usr/bin/env python3
"""Deterministic parent symlink swap against the pinned-fd experimental helper."""
import os
from pathlib import Path
import subprocess
import tempfile

source = Path(__file__).with_name('scoped-owned-create.c')
with tempfile.TemporaryDirectory(prefix='alix-ge04-race-') as td:
    base = Path(td)
    binary = base / 'create'
    subprocess.run(['gcc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
                    '-DGE04_TEST_HOOKS', str(source), '-o', str(binary)], check=True)
    workspace = base / 'workspace'
    workspace.mkdir()
    (workspace / 'owned').mkdir()
    (workspace / 'unowned').mkdir()
    ready_r, ready_w = os.pipe()
    continue_r, continue_w = os.pipe()
    try:
        env = {**os.environ, 'GE04_READY_FD': str(ready_w),
               'GE04_CONTINUE_FD': str(continue_r)}
        process = subprocess.Popen([str(binary), str(workspace), 'owned',
                                    'target.txt', 'pinned'], env=env,
                                   pass_fds=(ready_w, continue_r),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        os.close(ready_w)
        os.close(continue_r)
        assert os.read(ready_r, 1) == b'R', 'child did not reach pinned-fd barrier'
        (workspace / 'owned').rename(workspace / 'original-owned')
        (workspace / 'owned').symlink_to('unowned', target_is_directory=True)
        os.write(continue_w, b'C')
        stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 0, (process.returncode, stdout, stderr)
        assert (workspace / 'original-owned' / 'target.txt').read_text() == 'pinned'
        assert not (workspace / 'unowned' / 'target.txt').exists(), 'UNOWNED TARGET MODIFIED'
        print('GE-04 deterministic parent swap: PASS (pinned inode only; unowned sentinel untouched)')
    finally:
        os.close(ready_r)
        os.close(continue_w)
        if process.poll() is None:
            process.kill()
            process.wait()
