"""Windows ConPTY terminal-restoration check for the isolated OpenTUI fixture.

Runs the fixture in a pseudo-console via pywinpty (ConPTY) and asserts it
renders, exits cleanly on Escape, and enters and leaves the alternate screen.
Windows has no termios, so echo/line-mode restoration (asserted by the Unix
check) is out of scope here. Requires `pip install pywinpty`.
"""

import os
import threading
import time

from winpty import PtyProcess

FIXTURE_DIR = os.path.dirname(os.path.abspath(__file__))
ALT_SCREEN_ON = "\x1b[?1049h"
ALT_SCREEN_OFF = "\x1b[?1049l"


def spawn():
    argv = ["node", "--experimental-ffi", "static-workbench.mjs"]
    try:
        return PtyProcess.spawn(argv, cwd=FIXTURE_DIR, dimensions=(30, 120))
    except TypeError:
        # Older pywinpty accepts a command string, not an argv list.
        return PtyProcess.spawn(
            "node --experimental-ffi static-workbench.mjs",
            cwd=FIXTURE_DIR,
            dimensions=(30, 120),
        )


def main():
    process = spawn()
    sink = []

    def reader():
        while True:
            try:
                chunk = process.read()
            except (EOFError, OSError):
                break
            if chunk:
                sink.append(chunk)
            else:
                time.sleep(0.02)

    def text():
        return "".join(sink)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()

    deadline = time.monotonic() + 20
    while "Agents" not in text() and process.isalive() and time.monotonic() < deadline:
        time.sleep(0.1)
    assert "Agents" in text(), f"fixture did not render under ConPTY: {text()[-300:]!r}"

    # Retry: the fixture attaches its key listener only after the first render.
    for _ in range(12):
        if not process.isalive():
            break
        process.write("\x1b")
        time.sleep(0.5)

    deadline = time.monotonic() + 10
    while process.isalive() and time.monotonic() < deadline:
        time.sleep(0.1)
    if process.isalive():
        process.terminate(force=True)
    exit_code = process.wait()
    thread.join(timeout=5)

    output = text()
    assert exit_code == 0, f"fixture exit {exit_code}: {output[-300:]!r}"
    assert ALT_SCREEN_ON in output, "alternate screen did not start under ConPTY"
    assert ALT_SCREEN_OFF in output, "alternate screen was not restored under ConPTY"
    print("ConPTY: frame, Escape exit, and alternate-screen restoration passed on Windows")


main()
