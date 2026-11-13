#!/usr/bin/env python3
"""AST-derived direct imported Python call candidates, not dynamic resolution."""
import ast
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
OUTPUT = ROOT / 'docs/security/ge04-b1a-python-cross-module-candidates.json'
modules = {p.stem: p for p in BASE.glob('*.py')}
trees = {name: ast.parse(path.read_text(), filename=str(path)) for name, path in modules.items()}
functions = {name: {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
             for name, tree in trees.items()}
entries = []
for module, tree in sorted(trees.items()):
    aliases = {}
    module_aliases = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module in modules:
            for item in node.names:
                aliases[item.asname or item.name] = (node.module, item.name)
        elif isinstance(node, ast.Import):
            for item in node.names:
                if item.name in modules:
                    module_aliases[item.asname or item.name] = item.name
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.Call):
            continue
        dest = None
        if isinstance(fn.func, ast.Name) and fn.func.id in aliases:
            dest = aliases[fn.func.id]
        elif isinstance(fn.func, ast.Attribute) and isinstance(fn.func.value, ast.Name) and fn.func.value.id in module_aliases:
            dest = (module_aliases[fn.func.value.id], fn.func.attr)
        if dest is None:
            continue
        target_module, symbol = dest
        entries.append({'source': module + '.py', 'line': fn.lineno,
                        'callee': ast.unparse(fn.func), 'target': target_module + '.py:' + symbol,
                        'target_declared': symbol in functions[target_module]})
entries.sort(key=lambda e: (e['source'], e['line'], e['callee'], e['target']))
result = {'method': 'PYTHON_AST_DIRECT_IMPORT_CALL_CANDIDATES_NOT_RUNTIME_VERIFIED',
          'entries': entries, 'limitations': 'No dynamic imports, attribute alias propagation, indirect calls, class method resolution or runtime binding proof.'}
if '--write' in sys.argv:
    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
else:
    assert json.loads(OUTPUT.read_text()) == result, 'Python cross-module call candidate drift'
print(f'GE-04 Python: {len(entries)} direct imported call candidates; {sum(e["target_declared"] for e in entries)} target declarations found')
