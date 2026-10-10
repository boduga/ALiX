"""Linux/macOS terminal-session checks for the isolated OpenTUI fixture.

Covers escape-exit, Ctrl+C cancellation, SIGWINCH resize, focused typing, and
bracketed paste, asserting in each case that the alternate screen is entered and
left and the raw input-mode flags are restored. Windows has no equivalent check;
the PTY API used here is Unix-only.
"""

import fcntl
import os
import select
import signal
import struct
import subprocess
import termios
import time

FIXTURE_DIR = os.path.dirname(os.path.abspath(__file__))
ALT_SCREEN_ON = b"\x1b[?1049h"
ALT_SCREEN_OFF = b"\x1b[?1049l"


def spawn(cols=120, rows=30):
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    before = termios.tcgetattr(slave)
    process = subprocess.Popen(
        ["node", "--experimental-ffi", "static-workbench.mjs"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=FIXTURE_DIR,
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


def wait_for(process, master, marker, timeout=10):
    output = bytearray()
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        output.extend(drain(process, master, 0.1))
        if marker in output:
            break
    return output, marker in output


def exit_with(process, master, keys, tries=12, step=0.5):
    """Send an exit key, retrying: the fixture attaches its key listener only
    after the first render, so an early key can land before it is registered."""
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


def assert_restored(slave, before, process, output, label):
    after = termios.tcgetattr(slave)
    assert process.returncode == 0, f"{label}: fixture exit {process.returncode}: {output[-500:]!r}"
    assert ALT_SCREEN_ON in output, f"{label}: alternate screen did not start"
    assert ALT_SCREEN_OFF in output, f"{label}: alternate screen was not restored"
    assert (before[3] & (termios.ECHO | termios.ICANON)) == (
        after[3] & (termios.ECHO | termios.ICANON)
    ), f"{label}: terminal input mode not restored"


def run_scenario(label, prepare=None, exit_keys=b"\x1b"):
    master, slave, before, process = spawn()
    try:
        output, rendered = wait_for(process, master, b"Agents")
        assert rendered, f"{label}: static fixture did not render"
        if prepare is not None:
            output += prepare(master, process)
            assert process.poll() is None, f"{label}: fixture exited during setup: {output[-500:]!r}"
        output += exit_with(process, master, exit_keys)
        assert_restored(slave, before, process, output, label)
    finally:
        if process.poll() is None:
            process.kill()
        os.close(master)
        os.close(slave)


def prepare_resize(master, process):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 90, 0, 0))
    os.kill(process.pid, signal.SIGWINCH)
    return drain(process, master, 1)


def prepare_focus_and_paste(master, process):
    output = bytearray()
    os.write(master, b"focusok")
    typed = drain(process, master, 1)
    output += typed
    assert b"focusok" in typed, "focus: typed input did not reach the focused composer"
    os.write(master, b"\x1b[200~pasteok\x1b[201~")
    pasted = drain(process, master, 1)
    output += pasted
    assert b"pasteok" in pasted, "paste: bracketed paste did not reach the composer"
    return output


run_scenario("escape")
run_scenario("cancel", exit_keys=b"\x03")
run_scenario("resize", prepare=prepare_resize)
run_scenario("focus/paste", prepare=prepare_focus_and_paste)
print(
    "PTY: escape exit, Ctrl+C cancellation, SIGWINCH resize, and focused "
    "typing/bracketed paste all restored the terminal"
)
