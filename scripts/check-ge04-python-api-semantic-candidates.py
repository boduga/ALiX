#!/usr/bin/env python3
"""AST evidence that the *matched API token*, not another token on its line, is called.

Syntactic evidence only; indirect dispatch and security verdicts remain unresolved.
"""
import ast
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
SRC = ROOT / 'docs/security/ge04-b1a-sensitive-site-context.json'
OUT = ROOT / 'docs/security/ge04-b1a-python-api-semantic-candidates.json'
entries = []
for site in json.loads(SRC.read_text())['entries']:
    if not site['file'].endswith('.py'):
        continue
    lines = (BASE / site['file']).read_text().splitlines()
    tree = ast.parse('\n'.join(lines))
    line = site['line']
    matches = []
    for api in site['apis']:
        calls = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not (node.lineno <= line <= getattr(node, 'end_lineno', node.lineno)):
                continue
            fn = node.func
            if ((isinstance(fn, ast.Name) and fn.id == api) or
                (isinstance(fn, ast.Attribute) and fn.attr == api)):
                # Token can occur on a different line of a multiline call;
                # require the token itself on the pinned source line.
                if api in lines[line-1]:
                    calls.append(ast.unparse(fn))
        if calls:
            kind = 'MATCHED_API_DIRECT_CALL_SYNTAX'
        elif api == 'SCM_RIGHTS' and 'socket.SCM_RIGHTS' in lines[line-1] and '==' in lines[line-1]:
            kind = 'AUTHORITY_CONSTANT_REFERENCE'
        else:
            kind = 'MATCHED_API_NONCALL_OR_AMBIGUOUS'
        matches.append({'api': api, 'syntax': kind, 'matching_callees': sorted(set(calls))})
    entries.append({'file': site['file'], 'line': line, 'source': site['source'],
                    'matches': matches, 'security_verdict': 'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report = {'method': 'TOKEN_SPECIFIC_PYTHON_AST_CALL_SYNTAX_AUTHOR_TRIAGE',
          'entries': entries,
          'limitations': 'Does not resolve dynamic dispatch, aliasing, semantic authority, provenance or negative paths.'}
if '--write' in sys.argv:
    OUT.write_text(json.dumps(report, indent=2)+'\n')
else:
    assert json.loads(OUT.read_text()) == report, 'Python API semantic candidate drift'
from collections import Counter
print('GE-04 Python token-specific AST:', dict(Counter(m['syntax'] for e in entries for m in e['matches'])))
