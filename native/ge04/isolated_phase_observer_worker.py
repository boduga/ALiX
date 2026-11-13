"""GE-04 isolated read-only worker, diagnostic-only; no ACK or root mutation.

Runs solely as a child of bounded_phase_observer. stdin is one canonical
bootstrap record, stdout one small canonical observation or nothing on error.
"""
import json
import os
import sys
from pathlib import Path

# -I suppresses script-directory imports; use this fixed source sibling only.
# Local path custody is NOT a security guarantee for a future root controller.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from unprivileged_observer import require_unprivileged
from bootstrap_binding import LIMIT, parse_bootstrap_binding
from unit_kernel_observer import observe_manager_and_kernel
from protected_approval_observer import corroborate_existing_approval


def main():
    try:
        require_unprivileged()
        raw = sys.stdin.buffer.read(LIMIT + 1)
        record = dict(parse_bootstrap_binding(raw))
        original_approval = corroborate_existing_approval(record)
        observation = observe_manager_and_kernel(record)
        if corroborate_existing_approval(record) != original_approval:
            return 77
        if observation["status"] != "UNQUALIFIED_MANAGER_KERNEL_CORRELATION":
            return 77
        kernel = observation["kernel"]
        result = {
            "status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
            "managerOwner": observation["managerOwner"],
            "kernel": {
                "status": kernel["status"],
                "pid": kernel["pid"],
                "startticks": kernel["startticks"],
            },
        }
        payload = (json.dumps(result, sort_keys=True, separators=(",", ":"))
                   + "\n").encode("ascii")
        if len(payload) > 1024:
            return 77
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        # An absent unit or any undecidable kernel state is refusal.
        return 77


if __name__ == "__main__":
    sys.exit(main())
