#!/usr/bin/env python3
"""Root-only GE-04 denial concurrency and process-interruption regression tests.

Process death is NOT a power-loss durability test. No authorization or execution.
"""
import hashlib
import importlib.util
import json
import multiprocessing as mp
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != "linux" or os.geteuid() != 0:
    raise SystemExit("GE04 denial concurrency REQUIRES root (not a pass)")

BASE = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location("ge04_" + name.replace("-", "_"), BASE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

preflight = load("supervisor-preflight")
journal = load("supervisor-transition-journal")
recovery = load("supervisor-denial-reconcile")
audit = load("supervisor-ledger-audit")

def attempt_in(evidence, root):
    helper = root / "helper"
    if not helper.exists():
        helper.write_bytes(b"#!/bin/sh\nexit 0\n")
        helper.chmod(0o500)
    return preflight.prepare(helper, hashlib.sha256(helper.read_bytes()).hexdigest(), evidence)

def writer(evidence, attempt, reason, start, result):
    start.wait(10)
    try:
        journal.append_denial(evidence, attempt, reason)
        result.put(("ok", reason))
    except FileExistsError:
        result.put(("exists", reason))
    except BaseException as exc:
        result.put(("error", repr(exc)))

def crash_writer(evidence, attempt, stage):
    # A child process exits abruptly at a controlled journal boundary.
    original_open, original_write, original_fsync = os.open, os.write, os.fsync
    if stage == "before_create":
        def injected_open(path, flags, *args, **kwargs):
            if path == attempt + ".denied" and flags & os.O_CREAT:
                os._exit(77)
            return original_open(path, flags, *args, **kwargs)
        os.open = injected_open
    elif stage == "partial_write":
        def injected_write(fd, data):
            if isinstance(data, (bytes, bytearray)) and b'"state":"DENIED"' in data:
                original_write(fd, data[:max(1, len(data)//2)])
                os._exit(77)
            return original_write(fd, data)
        os.write = injected_write
    elif stage in ("before_file_fsync", "before_directory_fsync"):
        def injected_fsync(fd):
            mode = os.fstat(fd).st_mode
            import stat
            if stage == "before_file_fsync" and stat.S_ISREG(mode):
                os._exit(77)
            if stage == "before_directory_fsync" and stat.S_ISDIR(mode):
                os._exit(77)
            return original_fsync(fd)
        os.fsync = injected_fsync
    journal.append_denial(evidence, attempt, "operator_denied")
    os._exit(0)

def main():
    ctx = mp.get_context("fork")
    with tempfile.TemporaryDirectory(prefix="ge04-denial-race-", dir="/run") as tmp:
        root = Path(tmp)
        root.chmod(0o700)
        evidence = root / "evidence"
        evidence.mkdir(mode=0o700)
        attempt = attempt_in(evidence, root)
        start = ctx.Event()
        results = ctx.Queue()
        processes = [ctx.Process(target=writer, args=(evidence, attempt, "reason_" + str(i), start, results)) for i in range(12)]
        for process in processes:
            process.start()
        start.set()
        for process in processes:
            process.join(15)
            assert not process.is_alive() and process.exitcode == 0, "writer hung or crashed"
        outcomes = [results.get(timeout=5) for _ in processes]
        assert sum(kind == "ok" for kind, _ in outcomes) == 1, outcomes
        assert sum(kind == "exists" for kind, _ in outcomes) == 11, outcomes
        assert recovery.reconcile(evidence, attempt) == "DENIED"
        assert audit.audit(evidence) == ("DENY_ONLY", (attempt,))
        winner = next(reason for kind, reason in outcomes if kind == "ok")
        assert json.loads((evidence / (attempt + ".denied")).read_bytes())["reason"] == winner
        print("PASS: 12 same-attempt writers, one immutable winner")

        attempts = [attempt_in(evidence, root) for _ in range(6)]
        start = ctx.Event()
        results = ctx.Queue()
        processes = [ctx.Process(target=writer, args=(evidence, item, "parallel", start, results)) for item in attempts]
        for process in processes:
            process.start()
        start.set()
        for process in processes:
            process.join(15)
            assert not process.is_alive() and process.exitcode == 0
        assert [results.get(timeout=5)[0] for _ in processes].count("ok") == len(attempts)
        assert all(recovery.reconcile(evidence, item) == "DENIED" for item in attempts)
        assert audit.audit(evidence) == ("DENY_ONLY", tuple(sorted([attempt] + attempts)))
        print("PASS: six distinct-attempt writers")

    for stage in ("before_create", "partial_write", "before_file_fsync", "before_directory_fsync"):
        with tempfile.TemporaryDirectory(prefix="ge04-denial-crash-", dir="/run") as tmp:
            root = Path(tmp)
            root.chmod(0o700)
            evidence = root / "evidence"
            evidence.mkdir(mode=0o700)
            attempt = attempt_in(evidence, root)
            child = ctx.Process(target=crash_writer, args=(evidence, attempt, stage))
            child.start()
            child.join(15)
            assert not child.is_alive() and child.exitcode == 77, (stage, child.exitcode)
            state = recovery.reconcile(evidence, attempt)
            inventory, _ = audit.audit(evidence)
            if stage in ("before_create", "partial_write"):
                assert state == "UNCERTAIN" and inventory in ("NOT_AUTHORIZED_ONLY", "UNCERTAIN"), (stage, state, inventory)
            else:
                # Fully written records can be read after process death, but durability
                # across power loss is NOT established without a filesystem crash test.
                assert state in ("DENIED", "UNCERTAIN"), (stage, state)
                assert inventory in ("DENY_ONLY", "UNCERTAIN"), (stage, inventory)
            assert state != "AUTHORIZED"
            print(f"PASS: {stage}: reconciliation={state}, inventory={inventory}")
    print("GE04 denial concurrency/process-crash PASS (not power-loss qualified)")

if __name__ == "__main__":
    main()
