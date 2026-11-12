#!/usr/bin/env python3
"""AST-inventory of Python calls and sensitive authority references.

Candidate evidence only: Python AST is not runtime alias or authority analysis.
"""
import ast
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
OUT = ROOT / 'docs/security/ge04-b1a-python-ast-call-inventory.json'
entries = []
for path in sorted(BASE.glob('*.py')):
    tree = ast.parse(path.read_text(), filename=path.name)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        callee = ast.unparse(node.func)
        entries.append({'file': path.name, 'line': node.lineno,
                        'column': node.col_offset, 'callee': callee,
                        'shape': type(node.func).__name__})
entries.sort(key=lambda e: (e['file'], e['line'], e['column'], e['callee']))
report = {'method': 'PYTHON_AST_ALL_DIRECT_CALL_EXPRESSIONS_CANDIDATES',
          'files': len(list(BASE.glob('*.py'))), 'entries': entries,
          'limitations': 'No alias resolution, monkeypatch/runtime dispatch, C FFI, dynamically generated code or semantic security verdict.'}
if '--write' in sys.argv:
    OUT.write_text(json.dumps(report, indent=2) + '\n')
else:
    assert json.loads(OUT.read_text()) == report, 'Python AST call inventory drift'
print(f'GE-04 Python AST: {len(entries)} call expressions in {report["files"]} Python files')
