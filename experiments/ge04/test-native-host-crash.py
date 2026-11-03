#!/usr/bin/env python3
"""Native C helper survives host SIGKILL at the pinned-fd test barrier.

This is a test-hook-only process-lifecycle demonstration, NOT authenticated
receipt or authority verification. Never enable GE04_TEST_HOOKS in production.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

source = Path(__file__).with_name("scoped-owned-create.c")
with tempfile.TemporaryDirectory(prefix="ge04-native-host-crash-") as td:
    root = Path(td)
    binary = root / "native-create"
    subprocess.run(["cc", "-O2", "-Wall", "-Wextra", "-Werror",
                    "-DGE04_TEST_HOOKS", str(source), "-o", str(binary)], check=True)
    workspace = root / "workspace"
    workspace.mkdir()
    (workspace / "owned").mkdir()
    ready_r, ready_w = os.pipe()
    continue_r, continue_w = os.pipe()
    helper = None
    host = None
    try:
        # The intermediate Python host forks the REAL C helper, and then waits.
        # Its stdout reports the helper PID; parent controls the test barrier.
        host_code = """
import os, subprocess, sys, time
binary, workspace, ready_fd, continue_fd = sys.argv[1:]
env = dict(os.environ, GE04_READY_FD=ready_fd, GE04_CONTINUE_FD=continue_fd)
child = subprocess.Popen([binary, workspace, 'owned', 'target.txt', 'native'],
                         env=env, pass_fds=(int(ready_fd), int(continue_fd)),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(child.pid, flush=True)
while True: time.sleep(1)
"""
        host = subprocess.Popen(
            [sys.executable, "-c", host_code, str(binary), str(workspace),
             str(ready_w), str(continue_r)],
            pass_fds=(ready_w, continue_r), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        assert host.stdout is not None
        helper = int(host.stdout.readline().strip())
        os.close(ready_w)
        os.close(continue_r)
        assert os.read(ready_r, 1) == b"R", "native helper did not reach barrier"
        assert not (workspace / "owned" / "target.txt").exists()
        host.kill()
        assert host.wait(timeout=5) == -signal.SIGKILL
        # The helper remains blocked after host death, then writes when released.
        assert not (workspace / "owned" / "target.txt").exists()
        os.write(continue_w, b"C")
        deadline = __import__("time").monotonic() + 5
        while not (workspace / "owned" / "target.txt").exists():
            if __import__("time").monotonic() >= deadline:
                raise AssertionError("orphan native helper did not write")
            __import__("time").sleep(0.02)
        assert (workspace / "owned" / "target.txt").read_text() == "native"
        print("GE-04 native host SIGKILL: PASS (orphan C helper can mutate)")
    finally:
        for fd in (ready_r, continue_w):
            try: os.close(fd)
            except OSError: pass
        if host and host.poll() is None:
            host.kill()
            host.wait()
        if helper:
            try: os.kill(helper, signal.SIGKILL)
            except ProcessLookupError: pass
