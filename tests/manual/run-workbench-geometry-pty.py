#!/usr/bin/env python3
"""Real PTY resize/caret check for the production FramePainter (no model calls)."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

ROOT = Path(__file__).resolve().parents[2]
master, slave = pty.openpty()
def size(columns, rows):
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
size(200, 44)
entry = sys.argv[1] if len(sys.argv) > 1 else 'dist/tests/fixtures/tui/workbench-geometry-pty.js'
process = subprocess.Popen(['node', entry],
                           cwd=ROOT, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)

def frame(columns, rows):
    marker = f'__FRAME__{columns}x{rows}__'.encode()
    output = b''
    deadline = time.monotonic() + 15
    while marker not in output and time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                output += os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
    assert marker in output, f'Missing frame {columns}x{rows}: {output[-300:]!r}'
    cursors = re.findall(rb'\x1b\[(\d+);(\d+)H', output[:output.index(marker)])
    assert cursors, 'No hardware cursor address'
    row, column = map(int, cursors[-1])
    # The harness's authoritative Workbench cursor is at start, so column 4
    # at normal widths and column 1 on a one-cell terminal.
    assert column == min(4, columns), (columns, rows, row, column)
    assert 1 <= row <= rows, (columns, rows, row, column)
    if columns >= 160 and rows >= 36:
        assert b'AGENT DETAILS' in output, 'Wide frame missing inspector region'
    print(f'PASS PTY {columns}x{rows}: caret {row},{column}')

try:
    frame(200, 44)
    for columns, rows in [(160, 36), (140, 24), (79, 20), (200, 8), (4, 3), (1, 1), (200, 44)]:
        size(columns, rows)
        os.kill(process.pid, signal.SIGWINCH)
        frame(columns, rows)
    os.write(master, b'q')
    assert process.wait(timeout=5) == 0
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
    os.close(slave)
