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
process = subprocess.Popen(['node', 'dist/tests/fixtures/tui/workbench-phase8-pty.js'],
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
        # Potential action characters stay literal while composer owns focus.
        for character in 'c/13ad':
            state = state_after(character.encode())
        assert state['composer']['text'] == 'c/13ad'
        for _ in range(6):
            state = state_after(b'\x7f')
        assert state['composer']['text'] == ''
        # One bracketed block, normalized CRLF, complete combining/CJK/emoji.
        pasted = 'e\u0301界👩\u200d💻\r\nnext'
        state = state_after(b'\x1b[200~' + pasted.encode() + b'\x1b[201~')
        normalized = pasted.replace('\r\n', '\n')
        assert state['composer']['text'] == normalized
        assert state['composer']['cursor'] == len(normalized.encode('utf-16-le')) // 2
        state = state_after(b'\x1b[H')
        assert state['composer']['cursor'] == 0
        assert state['_caret'][1] == 4, state
        state = state_after(b'\x1b[C')
        assert state['composer']['cursor'] == 2
        assert state['_caret'][1] == 5, state
        state = state_after(b'\x1b[3~')
        assert state['composer']['text'] == 'e\u0301👩\u200d💻\nnext'
        state = state_after(b'\x7f')
        assert state['composer']['text'] == '👩\u200d💻\nnext'
        state = state_after(b'\x1b[C')
        assert state['composer']['cursor'] == 5
        assert state['_caret'][1] == 6, state
        state = state_after(b'\x7f')
        assert state['composer']['text'] == '\nnext'
        state = state_after(b'\x1b[F')
        for _ in range(5):
            state = state_after(b'\x7f')
        assert state['composer']['text'] == ''
        state = state_after(b'\x06')
        assert state['focus'] == 'transcript'
        state = state_after(b'3')
        assert state['transcriptFilter'] == 'tool' and state['composer']['text'] == ''
        state = state_after(b'f')
        assert state['followTail'] is False
        state = state_after(b'f')
        assert state['followTail'] is True
        state = state_after(b'\x1b')
        assert state['focus'] == 'composer'
        state = state_after(b'\x01')
        assert state['drawer'] == 'agents'
        state = state_after(b'\x05')
        assert state['overlayStack'][-1] == 'inspector'
        state = state_after(b'a')
        assert state['composer']['text'] == ''
        state = state_after(b'\x1b')
        assert not state['overlayStack'] and state['drawer'] == 'agents'
        assert state['focus'] == 'drawer'
        state = state_after(b'\x05')
        assert state['overlayStack'][-1] == 'inspector'
        state = state_after(b'\x12')
        assert not state['overlayStack'] and state['drawer'] == 'artifacts'
        state = state_after(b'\x1b')
        assert state['drawer'] == 'closed'
        # First Ctrl+C routes to active cancellation, keeping process alive.
        state_after(b'\x07')
        before = state['cancellationCount']
        state = state_after(b'\x03')
        assert state['cancellationCount'] == before + 1
        assert process.poll() is None
        print(f'PASS PTY {columns}x{rows}: literal action keys, paste, grapheme editing, focus/filter/follow, cancellation, caret bounds')
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
