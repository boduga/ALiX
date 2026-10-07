#!/usr/bin/env python3
"""Measure real raw-key-to-frame latency, without model or network calls."""
import errno
import fcntl
import json
from pathlib import Path
import pty
import os
import re
import select
import struct
import subprocess
import termios
import time

root = Path(__file__).resolve().parents[2]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 44, 200, 0, 0))
process = subprocess.Popen(['node', 'dist/tests/fixtures/tui/workbench-controls-pty.js'],
                           cwd=root, stdin=slave, stdout=slave, stderr=slave)

def state_frame():
    data = b''
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data += os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            states = re.findall(rb'__STATE__(.*?)__', data)
            if states:
                return json.loads(states[-1])
    raise AssertionError(f'Missing rendered state: {data[-300:]!r}')

try:
    assert state_frame()['text'] == ''
    text = ''
    milliseconds = []
    for character in 'typinglatency':
        started = time.perf_counter()
        os.write(master, character.encode())
        state = state_frame()
        milliseconds.append((time.perf_counter() - started) * 1000)
        text += character
        assert state['text'] == text
    assert max(milliseconds) < 250, milliseconds
    print(f'PASS raw-key-to-frame: median={sorted(milliseconds)[len(milliseconds)//2]:.1f}ms max={max(milliseconds):.1f}ms ({len(milliseconds)} keys, 200x44)')
    os.write(master, b'\x04')
    assert process.wait(timeout=5) == 0
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
    os.close(slave)
