"""GE-04 hard-deadline isolated systemd event observation, unqualified only.

Default worker is a separate unprivileged Python process and is always
killed/reaped on timeout. This parent has no unit mutation or ACK channel.
Input expected job is caller-provided, not independent original authority.
"""
import json
import math
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time
from types import MappingProxyType

from systemd_job_event_contract import JobEventWindow
from systemd_unit_observer import UNIT

WORKER = Path(__file__).resolve().with_name("isolated_job_signal_worker.py")
MAX_REQUEST = 256
MAX_RESPONSE = 256
_OWNER = re.compile(r":[0-9]+\.[0-9]+")
_JOB = re.compile(r"/org/freedesktop/systemd1/job/[1-9][0-9]{0,18}")


def _canonical_request(expected, window_ms):
    JobEventWindow(expected)
    if type(window_ms) is not int or not 1 <= window_ms <= 2000:
        raise ValueError("Invalid job event window")
    request = {"expected": dict(expected), "windowMs": window_ms}
    raw = (json.dumps(request, sort_keys=True, separators=(",", ":")) +
           "\n").encode("ascii")
    if len(raw) > MAX_REQUEST:
        raise ValueError("Oversized job observation request")
    return raw


def _canonical_witness(raw, expected):
    if not 0 < len(raw) <= MAX_RESPONSE or not raw.endswith(b"\n"):
        raise ValueError("No bounded systemd event witness")

    def no_duplicates(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError("Duplicate event witness key")
            out[key] = value
        return out

    try:
        witness = json.loads(raw.decode("ascii"), object_pairs_hook=no_duplicates)
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Malformed event witness") from exc
    if (type(witness) is not dict or frozenset(witness) !=
            {"status", "managerOwner", "jobPath", "unit", "result"} or
            witness["status"] != "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL" or
            witness["managerOwner"] != expected["managerOwner"] or
            type(witness["managerOwner"]) is not str or
            _OWNER.fullmatch(witness["managerOwner"]) is None or
            witness["jobPath"] != expected["jobPath"] or
            type(witness["jobPath"]) is not str or
            _JOB.fullmatch(witness["jobPath"]) is None or
            witness["unit"] != UNIT or witness["result"] != "done" or
            raw != (json.dumps(witness, sort_keys=True, separators=(",", ":")) +
                    "\n").encode("ascii")):
        raise ValueError("Unbound event witness")
    return MappingProxyType(witness)


def observe_job_signal_bounded(expected, deadline, *, window_ms=200):
    """Hard subprocess timeout; output is diagnostic and can be forged."""
    if (sys.platform != "linux" or os.geteuid() == 0 or
            type(deadline) not in (int, float) or not math.isfinite(deadline)
            or not 0 < deadline - time.monotonic() <= 3.0):
        raise PermissionError("GE-04 unprivileged bounded observation required")
    raw = _canonical_request(expected, window_ms)
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
        unsent = memoryview(raw)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("GE-04 isolated job event deadline")
            events = selector.select(remaining)
            if not events:
                raise TimeoutError("GE-04 isolated job event deadline")
            for item, _ in events:
                if item.fileobj is process.stdin:
                    try:
                        sent = os.write(process.stdin.fileno(), unsent)
                    except BrokenPipeError as exc:
                        raise ValueError("Job event worker refused input") from exc
                    if sent <= 0:
                        raise ValueError("Short isolated job request")
                    unsent = unsent[sent:]
                    if not unsent:
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    chunk = os.read(process.stdout.fileno(),
                                    MAX_RESPONSE + 1 - len(output))
                    if not chunk:
                        selector.unregister(process.stdout)
                        process.stdout.close()
                    else:
                        output.extend(chunk)
                        if len(output) > MAX_RESPONSE:
                            raise ValueError("Oversized isolated job witness")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("GE-04 isolated job event deadline")
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError("GE-04 isolated job event deadline") from exc
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait()
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if process.stdout and not process.stdout.closed:
            process.stdout.close()
    if process.returncode != 0 or time.monotonic() >= deadline:
        raise ValueError("No qualified bounded job event observation")
    return _canonical_witness(bytes(output), expected)
