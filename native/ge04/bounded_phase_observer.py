"""GE-04 bounded read-only observation subprocess, never ACK authority.

A fresh isolated Python subprocess owns its read-only kernel/manager reads,
with one end-to-end absolute monotonic deadline and terminal kill/reap.
This DOES NOT authenticate the source tree or expected prebirth record.
"""
import json
import os
from pathlib import Path
import subprocess
import selectors
import sys
import time
from types import MappingProxyType

from bootstrap_binding import LIMIT, FIELDS, parse_bootstrap_binding

WORKER = Path(__file__).resolve().with_name("isolated_phase_observer_worker.py")
MAX_OUTPUT = 1024


def observe_bounded(original, deadline):
    """Diagnostic only; no writer to fixture, no credentials or privilege."""
    if (sys.platform != "linux" or type(original) is not dict
            or type(deadline) not in (int, float) or not deadline > time.monotonic()):
        raise ValueError("Invalid bounded observation request")
    if frozenset(original) != FIELDS:
        raise ValueError("Incomplete bounded observer record")
    source = dict(original)
    if type(source["ancestry"]) is tuple:
        source["ancestry"] = [list(pair) for pair in source["ancestry"]]
    try:
        raw = (json.dumps(source, sort_keys=True, separators=(",", ":"))
               + "\n").encode("ascii")
        validated = parse_bootstrap_binding(raw)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ValueError("Invalid bounded observer original") from exc
    remaining = deadline - time.monotonic()
    if not 0 < remaining <= 3.0:
        raise ValueError("Unbounded observation duration")
    process = subprocess.Popen(
        [sys.executable, "-I", str(WORKER)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, close_fds=True,
        cwd="/", env={"PATH": "/usr/bin:/bin"},
    )
    output = bytearray()
    selector = selectors.DefaultSelector()
    try:
        os.set_blocking(process.stdin.fileno(), False)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE)
        selector.register(process.stdout, selectors.EVENT_READ)
        remaining_input = memoryview(raw)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("GE-04 read-only observer deadline")
            events = selector.select(remaining)
            if not events:
                raise TimeoutError("GE-04 read-only observer deadline")
            for item, _ in events:
                if item.fileobj is process.stdin:
                    try:
                        count = os.write(process.stdin.fileno(), remaining_input)
                    except BrokenPipeError as exc:
                        raise ValueError("Read-only observer refused input") from exc
                    if count <= 0:
                        raise ValueError("Short isolated observation write")
                    remaining_input = remaining_input[count:]
                    if not remaining_input:
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    chunk = os.read(process.stdout.fileno(), MAX_OUTPUT + 1 - len(output))
                    if not chunk:
                        selector.unregister(process.stdout)
                        process.stdout.close()
                    else:
                        output.extend(chunk)
                        if len(output) > MAX_OUTPUT:
                            raise ValueError("Oversized isolated observer output")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("GE-04 read-only observer deadline")
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError("GE-04 read-only observer deadline") from exc
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait()
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if process.stdout and not process.stdout.closed:
            process.stdout.close()
    output = bytes(output)
    if (process.returncode != 0 or not 0 < len(output) <= MAX_OUTPUT
            or not output.endswith(b"\n") or not time.monotonic() < deadline):
        raise ValueError("Missing or late bounded manager/kernel evidence")
    try:
        def unique(pairs):
            parsed = {}
            for key, value in pairs:
                if key in parsed:
                    raise ValueError("Duplicate observer field")
                parsed[key] = value
            return parsed
        witness = json.loads(output.decode("ascii"), object_pairs_hook=unique)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Malformed bounded observer evidence") from exc
    if (type(witness) is not dict or frozenset(witness) !=
            {"status", "managerOwner", "kernel"} or
            witness["status"] != "UNQUALIFIED_MANAGER_KERNEL_CORRELATION"
            or type(witness["managerOwner"]) is not str
            or not witness["managerOwner"].startswith(":")
            or type(witness["kernel"]) is not dict
            or frozenset(witness["kernel"]) != {"status", "pid", "startticks"}
            or witness["kernel"]["status"] != "UNQUALIFIED_KERNEL_UNIT_CORRELATION"
            or type(witness["kernel"]["pid"]) is not int
            or witness["kernel"]["pid"] != validated["keeperPid"]
            or type(witness["kernel"]["startticks"]) is not int
            or witness["kernel"]["startticks"] != validated["keeperTicks"]):
        raise ValueError("Unbound bounded observer evidence")
    canonical = (json.dumps(witness, sort_keys=True, separators=(",", ":"))
                 + "\n").encode("ascii")
    if canonical != output:
        raise ValueError("Noncanonical bounded observation")
    return MappingProxyType({
        "status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
        "managerOwner": witness["managerOwner"],
        "kernel": MappingProxyType(witness["kernel"]),
    })
