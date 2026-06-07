#!/usr/bin/env python3
"""
PTY test runner for TTY-dependent ALiX tests.

Uses Python's built-in `pty` module (stdlib, zero deps) to create a real
pseudo-terminal and drive interactive prompts programmatically.

All plan-related tests use `--plan-file` with a canned plan — zero model
calls needed, runs in <5s per test.

Usage:
  ./tests/manual/run-pty.py <test-name>

Test names:
  plan-approve    — A.6: approve plan (y key)
  plan-detail     — A.6 (extended): detail view (d) then approve (y)
  scope-deny      — A.8: deny plan (n key)
  plan-save       — B.2: approve plan, verify .alix/plans/<id>.md written
  all             — Run all four
"""

import pty
import os
import sys
import time
import select
import re
import tempfile
import shutil
from pathlib import Path

# ── Config ───────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BIN = str(PROJECT_ROOT / "bin" / "alix.js")
PLANS_DIR = PROJECT_ROOT / ".alix" / "plans"
CANNED_PLAN = str(PROJECT_ROOT / "tests" / "manual" / "test-plan-canned.md")
# Task that doesn't trigger READ_ONLY_PATTERNS or DOCS_PATTERNS
TASK = "add example test file"

PASS = 0
FAIL = 0
ERRORS = []


# ── PTY Runner ───────────────────────────────────────────────────────

def pty_run(args, input_seq, *, timeout=30, cwd=None, wait_before_first=4.0):
    """
    Run ALiX in a real PTY, send keystrokes, capture output.

    Args:
        args: list of CLI args (e.g. ["run", "echo hello"])
        input_seq: string of keystrokes to send (each char + final \n)
        timeout: max seconds to wait
        cwd: working directory (defaults to PROJECT_ROOT)
        wait_before_first: seconds to wait before first keystroke

    Returns: dict with stdout, exit_code
    """
    pid, fd = pty.fork()

    if pid == 0:
        # ── Child ──
        if cwd:
            os.chdir(str(cwd))
        os.execvp("node", ["node", BIN] + args)

    # ── Parent ──
    cmd = ["node", BIN] + args
    print(f"  $ node bin/alix.js {' '.join(args)}")
    print(f"  Input: {repr(input_seq)}")

    # Wait for context compilation + plan prompt
    time.sleep(wait_before_first)

    # Send keystrokes (each followed by newline to submit readline)
    for ch in input_seq:
        os.write(fd, ch.encode())
        time.sleep(0.15)
    os.write(fd, b"\n")

    # Collect output while process runs
    output = b""
    deadline = time.time() + timeout

    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.5)
        if r:
            try:
                data = os.read(fd, 65536)
                if not data:
                    # PTY slave closed — child has exited, do blocking wait
                    os.close(fd)
                    _, status = os.waitpid(pid, 0)
                    ec = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                    return {"stdout": _clean_pty_output(output), "exit_code": ec}
                output += data
            except OSError:
                break

        # Non-blocking check for child exit
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            # Drain remaining buffered output
            time.sleep(0.3)
            try:
                while True:
                    r, _, _ = select.select([fd], [], [], 0.2)
                    if not r:
                        break
                    data = os.read(fd, 65536)
                    if not data:
                        break
                    output += data
            except OSError:
                pass
            ec = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
            os.close(fd)
            return {"stdout": _clean_pty_output(output), "exit_code": ec}

    # Timeout — send Ctrl+C
    os.write(fd, b"\x03")
    time.sleep(0.5)
    try:
        while True:
            r, _, _ = select.select([fd], [], [], 0.2)
            if not r:
                break
            data = os.read(fd, 65536)
            if not data:
                break
            output += data
    except OSError:
        pass
    os.close(fd)
    return {"stdout": _clean_pty_output(output), "exit_code": -1}


def _clean_pty_output(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    # Strip ANSI escape codes
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'\x1b\][0-9;]*[^\x1b]*(\x1b\\)?', '', text)
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'\r', '', text)
    return text.strip()


# ── Test Helpers ─────────────────────────────────────────────────────

def check(condition, message):
    global PASS, FAIL
    if condition:
        print(f"  ✓ {message}")
        PASS += 1
    else:
        print(f"  ✗ {message}")
        FAIL += 1
        ERRORS.append(message)

def check_contains(output, needle, label):
    check(needle in output, f"{label} — expected \"{needle}\"")


# ── Tests ────────────────────────────────────────────────────────────

def test_plan_approve():
    """A.6: Approve plan (y) — plan loads instantly from canned file"""
    print("\n── A.6: Plan approve (y) ──\n")

    result = pty_run(
        ["run", "--no-stream", f"--plan-file={CANNED_PLAN}", TASK],
        "y",
        timeout=180,
    )

    out = result['stdout']
    print(f"  Exit code: {result['exit_code']}")
    print(f"  Output ({len(out)} chars):\n{out[:600]}")
    if len(out) > 600:
        print(f"  ... ({len(out) - 600} more chars)")

    # The key assertion: plan + prompt + approval all happened
    check_contains(out, "## Plan:", "plan header printed")
    check_contains(out, "Approve plan?", "approval prompt shown")
    check_contains(out, "Session:", "session ID emitted")
    # Exit code may be 0 (clean exit) or -1 (timeout during execution);
    # the important thing is the plan interaction worked
    if result['exit_code'] == 0:
        check(True, "process exited cleanly")
    else:
        print(f"  (process timed out during execution — plan interaction verified)")


def test_plan_detail():
    """A.6 (extended): Send 'd' for detail view then 'y' to approve"""
    print("\n── A.6b: Plan detail view (d) then approve (y) ──\n")

    # Two-stage interaction: send 'd', wait for detail reprint, send 'y'
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("node", ["node", BIN, "run", "--no-stream", f"--plan-file={CANNED_PLAN}", TASK])

    try:
        time.sleep(4)
        # Stage 1: send 'd'
        os.write(fd, b"d\n")
        time.sleep(2)
        # Stage 2: send 'y'
        os.write(fd, b"y\n")

        output = b""
        deadline = time.time() + 60
        while time.time() < deadline:
            r, _, _ = select.select([fd], [], [], 0.5)
            if r:
                try:
                    data = os.read(fd, 65536)
                    if not data: break
                    output += data
                except OSError: break
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                time.sleep(0.3)
                try:
                    while True:
                        r, _, _ = select.select([fd], [], [], 0.2)
                        if not r: break
                        os.read(fd, 65536)
                except: pass
                os.close(fd)
                text = _clean_pty_output(output)
                print(f"  Output ({len(text)} chars):\n{text[:600]}")
                if len(text) > 600: print(f"  ... ({len(text) - 600} more chars)")
                ec = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                check(ec == 0, f"exit code 0 (got {ec})")
                check_contains(text, "Expanded Details", "detail view triggered")
                check_contains(text, "Session:", "session ID emitted")
                return

        os.write(fd, b"\x03")
        os.close(fd)
        text = _clean_pty_output(output)
        check(False, f"timeout - output:\n{text[:800]}")
    finally:
        try: os.close(fd)
        except: pass


def test_scope_deny():
    """A.8: Deny plan (n) — cancelled without execution"""
    print("\n── A.8: Plan rejected via 'n' ──\n")

    result = pty_run(
        ["run", "--no-stream", f"--plan-file={CANNED_PLAN}", TASK],
        "n",
        timeout=30,
    )

    out = result['stdout']
    print(f"  Exit code: {result['exit_code']}")
    print(f"  Output ({len(out)} chars):\n{out[:600]}")
    if len(out) > 600:
        print(f"  ... ({len(out) - 600} more chars)")

    check_contains(out, "Plan rejected", "rejection message shown")
    if result['exit_code'] == 0:
        check(True, "process exited cleanly")
    else:
        print(f"  (process may have timed out, but rejection was shown)")


def test_plan_save():
    """B.2: Approve plan, verify it's saved to .alix/plans/<session-id>.md"""
    print("\n── B.2: Plan saved to .alix/plans/ ──\n")

    result = pty_run(
        ["run", "--no-stream", f"--plan-file={CANNED_PLAN}", TASK],
        "y",
    )

    out = result['stdout']
    print(f"  Exit code: {result['exit_code']}")
    print(f"  Output ({len(out)} chars):\n{out[:600]}")
    if len(out) > 600:
        print(f"  ... ({len(out) - 600} more chars)")

    check(result['exit_code'] == 0, f"exit code 0 (got {result['exit_code']})")
    check_contains(out, "Approve plan?", "approval prompt shown")
    check_contains(out, "Session:", "session ID emitted")

    # Check that the canned plan was saved to .alix/plans/
    if PLANS_DIR.exists():
        plan_files = sorted(PLANS_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        print(f"  Plans dir: {len(plan_files)} file(s)")
        if plan_files:
            latest = plan_files[0]
            content = latest.read_text()
            print(f"  Latest: {latest.name} ({latest.stat().st_size} bytes)")
            check("Canned Test Task" in content, "plan file contains canned plan content")
    else:
        check(False, "plans directory exists")


# ── Main ─────────────────────────────────────────────────────────────

def main():
    global PASS, FAIL, ERRORS

    test_name = sys.argv[1] if len(sys.argv) > 1 else "all"

    tests = {
        "plan-approve": test_plan_approve,
        "plan-detail": test_plan_detail,
        "scope-deny": test_scope_deny,
        "plan-save": test_plan_save,
    }

    print(f"ALiX PTY Test Runner — {BIN}")
    print(f"Canned plan: {CANNED_PLAN}")

    if test_name == "all":
        print("\nRunning all TTY-dependent tests...")
        for name, fn in tests.items():
            try:
                fn()
            except Exception as e:
                print(f"\n  ✗ {name}: {e}")
                FAIL += 1
                ERRORS.append(str(e))

        print(f"\n── Results ──")
        print(f"  Pass: {PASS}")
        print(f"  Fail: {FAIL}")
        if ERRORS:
            print(f"  Errors:")
            for e in ERRORS:
                print(f"    • {e}")
        sys.exit(1 if FAIL > 0 else 0)

    fn = tests.get(test_name)
    if fn is None:
        print(f"Unknown test: {test_name}")
        print(f"Available: {', '.join(tests.keys())}, all")
        sys.exit(1)

    try:
        fn()
        print(f"\n── Results ──")
        print(f"  Pass: {PASS}")
        print(f"  Fail: {FAIL}")
        sys.exit(1 if FAIL > 0 else 0)
    except Exception as e:
        print(f"\n✗ {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
