#!/usr/bin/env python3
"""Actual PTY focus/filter/follow checks through production TuiApp input."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import termios
import time

root = Path(__file__).resolve().parents[2]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 44, 200, 0, 0))
process = subprocess.Popen(['node', 'dist/tests/fixtures/tui/workbench-controls-pty.js'], cwd=root,
                           stdin=slave, stdout=slave, stderr=slave, start_new_session=True)

def state_after(key=None):
    if key is not None:
        os.write(master, key)
    output = b''
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                output += os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            match = re.search(rb'__STATE__(\{[^\r\n]+\})__', output)
            if match:
                return json.loads(match.group(1))
    raise AssertionError(f'Missing state marker: {output[-500:]!r}')

try:
    assert state_after()['focus'] == 'composer'
    assert state_after(b's')['text'] == 's'
    assert state_after(b'\x06')['focus'] == 'transcript'
    assert state_after(b'3')['filter'] == 'tool'
    assert state_after(b's')['scope'] == 'selected'
    assert state_after(b'f')['follow'] is False
    assert state_after(b'\x1b')['focus'] == 'composer'
    assert state_after(b'5')['text'] == 's5'
    assert state_after(b'\x01')['drawer'] == 'agents'
    scoped = state_after(b'3')
    assert scoped['filter'] == 'tool' and scoped['text'] == 's5'
    assert state_after(b'\x1b')['drawer'] == 'closed'
    assert state_after(b'\x06')['focus'] == 'transcript'
    assert state_after(b'f')['follow'] is True
    os.write(master, b'\x04')
    assert process.wait(timeout=5) == 0
    print('PASS PTY composer/transcript/drawer focus, category/scope/follow, cleanup')
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
    os.close(slave)
