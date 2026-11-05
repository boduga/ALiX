#!/usr/bin/env python3
"""Read-only, deny-only Q3.2 filesystem custody diagnostics.

NOT a secure path opener, trust verifier, authorization gate or release check.
Results are snapshots vulnerable to races; a successful inspection never clears HOLD.
"""
import argparse
import json
import os
from pathlib import Path
import stat

DENIED = 'DENIED GE04_SECURITY_HOLD'


def inspect_custody(root: Path, supervisor_uid: int, coordinator_uid: int) -> dict:
    """Inspect a test-owned root and required files without following symlinks."""
    failures = []
    root = Path(root)
    if not root.is_absolute() or '..' in root.parts or supervisor_uid == coordinator_uid:
        failures.append('invalid_identity_or_path')
    # This is intentionally an inspection, not an openat2-based secure lookup.
    expected = {'policy.json': 0o600, 'claims.sqlite': 0o600, 'issuer.pub': 0o600}
    try:
        parent = os.lstat(root)
        if not stat.S_ISDIR(parent.st_mode) or stat.S_IMODE(parent.st_mode) != 0o700:
            failures.append('root_type_or_mode')
        if parent.st_uid != supervisor_uid:
            failures.append('root_owner')
    except OSError:
        failures.append('root_unavailable')
    for name, mode in expected.items():
        try:
            entry = os.lstat(root / name)
            if not stat.S_ISREG(entry.st_mode) or stat.S_IMODE(entry.st_mode) != mode:
                failures.append(name + '_type_or_mode')
            if entry.st_uid != supervisor_uid:
                failures.append(name + '_owner')
            if entry.st_nlink != 1:
                failures.append(name + '_link_count')
        except OSError:
            failures.append(name + '_unavailable')
    return {'gate': 'GE04_Q32_CUSTODY_PREFLIGHT', 'disposition': 'HOLD',
            'qualified_independent_custody': False, 'snapshot_checks_passed': not failures,
            'failures': failures, 'response': DENIED}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--supervisor-uid', type=int, required=True)
    parser.add_argument('--coordinator-uid', type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect_custody(args.root, args.supervisor_uid, args.coordinator_uid), sort_keys=True))
    return 78  # Even a clean snapshot never authorizes anything.


if __name__ == '__main__':
    raise SystemExit(main())
