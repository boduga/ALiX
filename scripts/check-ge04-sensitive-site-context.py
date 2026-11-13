#!/usr/bin/env python3
"""Source-grounded context for every lexical sensitive-site candidate.

Author triage only. Does not infer authorization, race freedom, or human verdict.
"""
import ast
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
INVENTORY = ROOT / 'docs/security/ge04-b1a-sensitive-api-review-inventory.json'
TRIAGE = ROOT / 'docs/security/ge04-b1a-sensitive-api-triage.json'
OUTPUT = ROOT / 'docs/security/ge04-b1a-sensitive-site-context.json'
items = json.loads(INVENTORY.read_text())['entries']
queue = json.loads(TRIAGE.read_text())['entries']
assert len(items) == len(queue)
cache = {}
result = []
for item, reviewed in zip(items, queue):
    name, line_no = item['file'], item['line']
    if name not in cache:
        path = BASE / name
        lines = path.read_text().splitlines()
        tree = ast.parse('\n'.join(lines), filename=name) if path.suffix == '.py' else None
        cache[name] = (lines, tree)
    lines, tree = cache[name]
    assert lines[line_no-1].strip() == item['source']
    if tree is not None:
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and
                 n.lineno <= line_no <= getattr(n, 'end_lineno', n.lineno)]
        call_names = sorted(set(ast.unparse(n.func) for n in calls))
        scopes = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and
                  n.lineno <= line_no <= getattr(n, 'end_lineno', n.lineno)]
        scope = min(scopes, key=lambda n: n.end_lineno-n.lineno).name if scopes else '<module>'
        shape = 'AST_CALL' if calls else 'REFERENCE_OR_NONCALL'
    else:
        # Approximate C function boundaries; intentionally not a semantic C parser.
        funcs = [(i+1, m.group(1)) for i, line in enumerate(lines)
                 if (m := re.match(r'^\s*(?:static\s+)?(?:inline\s+)?(?:[\w* ]+\s+)([A-Za-z_]\w*)\s*\([^;]*\)\s*\{', line))]
        scope = next((fn for at, fn in reversed(funcs) if at <= line_no), '<unknown C scope>')
        call_names = []
        shape = 'C_SOURCE_LEXICAL_CANDIDATE'
    result.append({'file': name, 'line': line_no, 'apis': item['apis'],
                   'source': item['source'], 'scope_candidate': scope,
                   'syntax_classification': shape, 'ast_call_callees': call_names,
                   'context_before': lines[max(0,line_no-4):line_no-1],
                   'context_after': lines[line_no:min(len(lines),line_no+3)],
                   'review_categories': reviewed['review_categories'],
                   'required_checks': reviewed['review_checks'],
                   'author_disposition': 'REQUIRES_SOURCE_LEVEL_SECURITY_ADJUDICATION',
                   'human_verdict': 'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report = {'method': 'AUTHOR_CONTEXT_ENRICHMENT_NOT_SEMANTIC_SECURITY_VERDICT',
          'entries': result,
          'limitations': 'C scope approximation, no C AST, no interprocedural authorization proof, no runtime alias resolution, no human security acceptance.'}
if '--write' in sys.argv:
    OUTPUT.write_text(json.dumps(report, indent=2) + '\n')
else:
    assert json.loads(OUTPUT.read_text()) == report, 'Sensitive site context drift'
print(f'GE-04 sensitive sites: {len(result)} current candidates with source context; '
      f'{sum(e["syntax_classification"]=="AST_CALL" for e in result)} Python AST calls')
