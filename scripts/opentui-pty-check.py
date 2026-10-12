"""Production PTY check for the OpenTUI renderer (Unix only).

Spawns the built CLI as `alix tui --renderer opentui` inside a PTY and asserts
the native renderer enters and leaves the alternate screen, restores terminal
input modes, survives a SIGWINCH resize, and exits 0 on Ctrl+C.
"""

import fcntl
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "dist", "src", "cli.js")
ALT_SCREEN_ON = b"\x1b[?1049h"
ALT_SCREEN_OFF = b"\x1b[?1049l"
RENDER_MARKER = b"ALiX WORKBENCH"


def spawn(cols=120, rows=30):
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    before = termios.tcgetattr(slave)
    process = subprocess.Popen(
        ["node", "--experimental-ffi", CLI, "tui", "--renderer", "opentui"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=ROOT,
        start_new_session=True,
    )
    return master, slave, before, process


def drain(process, master, timeout):
    output = bytearray()
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break
    return output


def wait_for(process, master, marker, timeout=20):
    output = bytearray()
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        output.extend(drain(process, master, 0.1))
        if marker in output:
            return output, True
    return output, marker in output


def exit_with(process, master, keys, tries=12, step=0.5):
    output = bytearray()
    for _ in range(tries):
        if process.poll() is not None:
            break
        os.write(master, keys)
        output.extend(drain(process, master, step))
    if process.poll() is None:
        process.kill()
    process.wait(timeout=3)
    return output


def main():
    master, slave, before, process = spawn()
    try:
        output, rendered = wait_for(process, master, RENDER_MARKER)
        assert rendered, f"production renderer did not render: {output[-500:]!r}"

        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 90, 0, 0))
        os.kill(process.pid, signal.SIGWINCH)
        output += drain(process, master, 1)

        output += exit_with(process, master, b"\x03")

        after = termios.tcgetattr(slave)
        assert process.returncode == 0, f"renderer exit {process.returncode}: {output[-500:]!r}"
        assert ALT_SCREEN_ON in output, "alternate screen did not start"
        assert ALT_SCREEN_OFF in output, "alternate screen was not restored"
        assert (before[3] & (termios.ECHO | termios.ICANON)) == (
            after[3] & (termios.ECHO | termios.ICANON)
        ), "terminal input mode not restored"
    finally:
        if process.poll() is None:
            process.kill()
        os.close(master)
        os.close(slave)

    print("PTY: production OpenTUI renderer started, resized, and restored on Ctrl+C")
    return 0


if __name__ == "__main__":
    sys.exit(main())
