"""GE-04 isolated read-only JobRemoved worker; never a privileged controller.

Input and output each use one canonical small JSON line. No file/socket
publisher, ACK or unit creation. Only the unprivileged bounded parent runs it.
"""
import json
import os
from pathlib import Path
import sys

# -I excludes local imports; only fixed sibling source is referenced.
# User-writable worktree is NOT trusted binary/source custody.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from systemd_job_signal_observer import observe_fixed_job_signal
from systemd_job_event_contract import JobEventWindow

MAX_REQUEST = 256
MAX_RESPONSE = 256


def main():
    if os.geteuid() == 0:
        return 77
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if not raw or len(raw) > MAX_REQUEST or not raw.endswith(b"\n"):
            return 77

        def no_duplicates(pairs):
            output = {}
            for name, value in pairs:
                if name in output:
                    raise ValueError("Duplicate request key")
                output[name] = value
            return output

        request = json.loads(raw.decode("ascii"), object_pairs_hook=no_duplicates)
        if (type(request) is not dict or frozenset(request) !=
                {"expected", "windowMs"} or type(request["expected"]) is not dict
                or type(request["windowMs"]) is not int
                or not 1 <= request["windowMs"] <= 2000):
            return 77
        JobEventWindow(request["expected"])
        if raw != (json.dumps(request, sort_keys=True, separators=(",", ":")) +
                   "\n").encode("ascii"):
            return 77
        witnessed = observe_fixed_job_signal(
            request["expected"], window_seconds=request["windowMs"] / 1000)
        if witnessed["status"] != "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL":
            return 77
        result = dict(witnessed)
        encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) +
                   "\n").encode("ascii")
        if len(encoded) > MAX_RESPONSE:
            return 77
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        return 77


if __name__ == "__main__":
    sys.exit(main())
