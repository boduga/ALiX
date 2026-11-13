#!/usr/bin/env python3
"""Fail when the GE-04 review matrix source-reference counts drift.

Counts are textual references, not evidence of test coverage or execution.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / 'docs/security/ge04-b1a-source-authority-review-matrix.md'
TABLE = MATRIX.read_text().split('## Sensitive-site inventory', 1)[0]
ROW = re.compile(r'^\| `([^`]+\.(?:c|py))` \| ([^|]+) \| ([^|]+) \| (\d+) \|$', re.M)
TESTS = sorted(list((ROOT / 'tests').rglob('*.py')) + list((ROOT / 'tests').rglob('*.ts')))
CONTENT = [(p, p.read_text(errors='replace')) for p in TESTS]
rows = list(ROW.finditer(TABLE))
if len(rows) != 53:
    raise SystemExit(f'Expected 53 GE-04 source rows, found {len(rows)}')
errors = []
for match in rows:
    name, _, _, claimed = match.groups()
    module = re.compile(r'(?<![A-Za-z0-9_])' + re.escape(name[:-3]) + r'(?![A-Za-z0-9_])') if name.endswith('.py') else None
    observed = sum(name in text or (module is not None and module.search(text) is not None)
                   for _, text in CONTENT)
    if observed != int(claimed):
        errors.append(f'{name}: matrix={claimed}, textual test references={observed}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'GE-04 matrix: {len(rows)} source rows; textual test-reference counts match')
