#!/usr/bin/env python3
"""Real PTY input, Unicode cursor, resize and production terminal cleanup QA."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time

ROOT = Path(__file__).resolve().parents[2]
master, slave = pty.openpty()
initial_modes = termios.tcgetattr(slave)


def resize(columns, rows):
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))


resize(200, 44)
process = subprocess.Popen(['node', 'dist/tests/fixtures/tui/workbench-phase9-pty.js'],
                           cwd=ROOT, stdin=slave, stdout=slave, stderr=slave,
                           start_new_session=True)
all_output = bytearray()


def state_after(key=None):
    if key is not None:
        os.write(master, key)
    output = b''
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                output += os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            matches = re.findall(rb'__STATE__(\{[^\r\n]+\})__', output)
            if matches:
                all_output.extend(output)
                state = json.loads(matches[-1])
                cursors = re.findall(rb'\x1b\[(\d+);(\d+)H', output)
                if cursors:
                    row, column = map(int, cursors[-1])
                    assert 1 <= row <= state['rows'], (row, state)
                    assert 1 <= column <= state['columns'], (column, state)
                    state['_caret'] = [row, column]
                return state
    raise AssertionError(f'Missing state marker: {output[-500:]!r}')


try:
    state = state_after()
    assert state['focus'] == 'composer' and state['raw'] is True
    for columns, rows in [(200, 44), (134, 33)]:
        if state['columns'] != columns:
            resize(columns, rows)
            os.kill(process.pid, signal.SIGWINCH)
            state = state_after()
        assert (state['columns'], state['rows']) == (columns, rows)
        # Opening/navigation and bracketed paste never launch work.
        before = len(state['launches'])
        if state['drawer'] != 'agents':
            state = state_after(b'\x01')
        state = state_after(b'c')
        assert 'coordination' in state['overlayStack']
        assert len(state['launches']) == before
        # Cancelled launch retains its objective; clear before the next launch.
        for _ in state['coordination']['draft']['text']:
            state = state_after(b'\x7f')
        state = state_after(b'\x1b[200~Create four scoped reports\x1b[201~')
        assert len(state['launches']) == before
        assert state['composer']['text'] == ''
        state = state_after(b'\r')
        assert len(state['launches']) == before + 1, state
        assert state['launches'][-1]['goal'] == 'Create four scoped reports'
        state = state_after(b'\r')
        assert len(state['launches']) == before + 1, state
        cancellation_before = state['cancellationCount']
        state = state_after(b'\x1b')
        assert 'coordination' not in state['overlayStack']
        assert state['cancellationCount'] == cancellation_before
        state = state_after(b'\x03')
        assert state['cancellationCount'] == cancellation_before + 1
        assert process.poll() is None
        # Reopening and cancelling the isolated draft still never launches.
        if state['drawer'] != 'agents':
            state = state_after(b'\x01')
        state = state_after(b'c')
        state = state_after(b'\x1b')
        assert len(state['launches']) == before + 1, state
        print(f'PASS PTY {columns}x{rows}: objective editor, explicit launch, duplicate suppression, Esc isolation, Ctrl+C, caret bounds')
    os.write(master, b'\x04')
    cleanup_deadline = time.monotonic() + 5
    while process.poll() is None and time.monotonic() < cleanup_deadline:
        if select.select([master], [], [], 0.1)[0]:
            all_output.extend(os.read(master, 65536))
    assert process.wait(timeout=5) == 0
    # Drain cleanup after exit too; the child may exit before the read loop runs.
    while select.select([master], [], [], 0.1)[0]:
        try:
            all_output.extend(os.read(master, 65536))
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
    assert b'__CLEANUP__{"raw":false}__' in all_output
    for sequence in [b'\x1b[?2004h', b'\x1b[?2004l', b'\x1b[?25h', b'\x1b[?1049h', b'\x1b[?1049l']:
        assert sequence in all_output, sequence
    restored = termios.tcgetattr(slave)
    for flag in [termios.ICANON, termios.ECHO, termios.ISIG]:
        assert restored[3] & flag == initial_modes[3] & flag
    print('PASS PTY terminal cleanup: raw/canonical/echo/signals, cursor, bracketed paste, alternate buffer')
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
    os.close(slave)
