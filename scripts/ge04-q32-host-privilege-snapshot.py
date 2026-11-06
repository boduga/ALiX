#!/usr/bin/env python3
"""Read-only, nonprivileged GE-04 host privilege observations. Always HOLD."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

GATE = 'GE04_Q32_HOST_PRIVILEGE_SNAPSHOT'

def inspect(paths):
    observations = {}
    warnings = []
    status = Path('/proc/self/status')
    if status.exists():
        fields = ('Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs', 'Seccomp')
        lines = status.read_text().splitlines()
        observations['self_process'] = {k: v.strip() for line in lines if ':' in line
                                        for k, v in [line.split(':', 1)] if k in fields}
    else:
        warnings.append('proc_status_unavailable')
    observations['mountinfo_accessible'] = Path('/proc/self/mountinfo').is_file()
    for i, path in enumerate(paths):
        p = Path(path)
        key = 'path_' + str(i)
        if not p.is_absolute():
            warnings.append(key + ':not_absolute')
            continue
        observations[key] = {'path': str(p), 'exists': p.exists(), 'acl': 'not_checked'}
        try:
            proc = subprocess.run(['getfacl', '-cp', '--', str(p)], capture_output=True,
                                  text=True, timeout=3, check=False)
            if proc.returncode == 0:
                # ACL metadata only, never file content
                observations[key]['acl'] = proc.stdout[:4096]
            else:
                warnings.append(key + ':acl_unavailable')
        except (OSError, subprocess.TimeoutExpired):
            warnings.append(key + ':acl_unavailable')
    return {'gate': GATE, 'disposition': 'HOLD', 'qualified_independent_issuance': False,
            'observations': observations, 'warnings': warnings,
            'limits': 'self_process_only_no_sudoers_or_other_process_or_mount_integrity_proof'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect-path', action='append', default=[])
    args = parser.parse_args()
    print(json.dumps(inspect(args.inspect_path), sort_keys=True))
    return 78

if __name__ == '__main__':
    sys.exit(main())
