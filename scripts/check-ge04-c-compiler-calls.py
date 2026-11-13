#!/usr/bin/env python3
"""GCC lowered C call-expression inventory (author evidence, no execution)."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
OUT = ROOT / 'docs/security/ge04-b1a-c-compiler-call-inventory.json'
# GCC original dumps preserve direct calls but can add compiler builtins and lose
# source locations. A semantic security reviewer must still inspect source.
PATTERN = re.compile(r'(?<![\w.>])([A-Za-z_]\w*)\s*\(')
entries = []
failed = []
with tempfile.TemporaryDirectory(prefix='ge04-c-ast-') as folder:
    for source in sorted(BASE.glob('*.c')):
        work = Path(folder) / source.stem
        work.mkdir()
        run = subprocess.run(['gcc', '-std=gnu11', '-O0', '-I', str(BASE),
                              '-fdump-tree-original', '-c', str(source), '-o', 'probe.o'],
                             cwd=work, capture_output=True, text=True)
        if run.returncode:
            failed.append({'file': source.name, 'error': run.stderr[-2000:]})
            continue
        dumps = list(work.glob('*.original'))
        if len(dumps) != 1:
            failed.append({'file': source.name, 'error': 'missing/ambiguous GCC original dump'})
            continue
        content = dumps[0].read_text()
        calls = sorted(set(PATTERN.findall(content)))
        entries.append({'file': source.name, 'lowered_call_name_candidates': calls})
report = {'method': 'GCC_13_ORIGINAL_TREE_LOWERED_CALL_NAME_CANDIDATES',
          'compiler': subprocess.run(['gcc', '-dumpfullversion'], capture_output=True, text=True, check=True).stdout.strip(),
          'entries': entries, 'compile_failures': failed,
          'limitations': 'GCC original dump name tokens are overinclusive (declarations/control syntax), may omit indirect/macro provenance, and do not provide source callsite locations. NOT semantic review or runtime authority proof.'}
if '--write' in sys.argv:
    OUT.write_text(json.dumps(report, indent=2) + '\n')
else:
    assert json.loads(OUT.read_text()) == report, 'GCC C call inventory drift'
print(f'GE-04 GCC: {len(entries)} C files compiled; {len(failed)} failed; {sum(len(e["lowered_call_name_candidates"]) for e in entries)} unique per-file name candidates')
if failed:
    print('Compile failures:', [x['file'] for x in failed])
    raise SystemExit(1)
