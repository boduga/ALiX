#!/usr/bin/env python3
"""Compile selected GE-04 source objects without executing privileged binaries.

Checks undefined references and exported definitions; not a final link or runtime proof.
"""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
report = json.loads((ROOT / 'docs/security/ge04-b1a-cross-tu-candidates.json').read_text())
entries = report['unique_cross_tu_candidates']
files = sorted({e['caller'].split(':', 1)[0] for e in entries} |
               {e['candidate_targets'][0].split(':', 1)[0] for e in entries})
with tempfile.TemporaryDirectory(prefix='ge04-cross-tu-') as directory:
    symbols = {}
    for file in files:
        obj = Path(directory) / (file + '.o')
        subprocess.run(['cc', '-std=gnu11', '-O0', '-Wall', '-Wextra', '-Werror',
                        '-I', str(BASE), '-c', str(BASE / file), '-o', str(obj)],
                       check=True, capture_output=True, text=True)
        raw = subprocess.run(['nm', '-g', str(obj)], check=True,
                             capture_output=True, text=True).stdout
        symbols[file] = {(parts[-1], parts[-2]) for line in raw.splitlines()
                         if len(parts := line.split()) >= 2}
    for entry in entries:
        source, name = entry['caller'].split(':', 1)[0], entry['unresolved'].split(':', 1)[1]
        target = entry['candidate_targets'][0].split(':', 1)[0]
        assert (name, 'U') in symbols[source], f'No undefined reference: {source} -> {name}'
        assert any(sym == name and kind in ('T', 'W') for sym, kind in symbols[target]), (
            f'No exported definition: {target} -> {name}')
print(f'GE-04 object symbols: {len(entries)} cross-TU references verified across {len(files)} compiled objects; no privileged execution')
