"""Linux/macOS terminal-session check for the isolated OpenTUI fixture."""

import fcntl
import os
import select
import struct
import subprocess
import sys
import termios
import time


master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 120, 0, 0))
before = termios.tcgetattr(slave)
process = subprocess.Popen(
    ["node", "--experimental-ffi", "static-workbench.mjs"],
    stdin=slave,
    stdout=slave,
    stderr=slave,
    cwd=os.path.dirname(__file__),
)
output = bytearray()
deadline = time.monotonic() + 10
sent_escape = False
try:
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break
        if not sent_escape and b"Agents" in output:
            os.write(master, b"\x1b")
            sent_escape = True
    if process.poll() is None:
        process.kill()
    process.wait(timeout=2)
    after = termios.tcgetattr(slave)
    assert sent_escape, "static fixture did not render"
    assert process.returncode == 0, f"fixture exit {process.returncode}: {output[-500:]!r}"
    assert b"\x1b[?1049h" in output, "alternate screen did not start"
    assert b"\x1b[?1049l" in output, "alternate screen was not restored"
    assert (before[3] & (termios.ECHO | termios.ICANON)) == (after[3] & (termios.ECHO | termios.ICANON)), "terminal input mode not restored"
    print("PTY: frame, Escape exit, alternate-screen restoration, and input-mode restoration passed")
finally:
    os.close(master)
    os.close(slave)
