#!/usr/bin/env python3
"""Native C helper must die with its spawning host before a paused mutation.

This is a test-hook-only process-lifecycle regression, NOT authenticated
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
        # PDEATHSIG kills the paused helper; it must never create a file.
        import time
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            stat_path = Path(f"/proc/{helper}/stat")
            if not stat_path.exists() or stat_path.read_text().split(') ')[1][0] in 'ZX':
                break
            time.sleep(0.02)
        else:
            raise AssertionError("native helper survived parent SIGKILL")
        assert not (workspace / "owned" / "target.txt").exists()
        try:
            os.write(continue_w, b"C")
        except BrokenPipeError:
            pass
        time.sleep(0.1)
        assert not (workspace / "owned" / "target.txt").exists()
        print("GE-04 native host SIGKILL: PASS (helper terminated before mutation)")
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
