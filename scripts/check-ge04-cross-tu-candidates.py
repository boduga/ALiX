#!/usr/bin/env python3
"""Reconcile unique-name cross-TU lexical candidates; not linker proof."""
import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'docs/security/ge04-b1a-candidate-callgraph.json').read_text())
result = json.loads((ROOT / 'docs/security/ge04-b1a-cross-tu-candidates.json').read_text())
by_symbol = defaultdict(list)
for node in source['nodes']:
    by_symbol[node.split(':', 1)[-1]].append(node)
resolved = []
ambiguous = []
for caller, target, kind in source['edges']:
    if kind != 'c-lexical-unresolved' or not target.startswith('unresolved:ge04_'):
        continue
    candidates = sorted(node for node in by_symbol[target.split(':', 1)[1]]
                        if node.split(':', 1)[0] != caller.split(':', 1)[0])
    entry = dict(caller=caller, unresolved=target, candidate_targets=candidates)
    (resolved if len(candidates) == 1 else ambiguous).append(entry)
assert result['source_revision'] == source['source_revision']
assert result['resolution'] == 'UNIQUE_NAME_CANDIDATES_NOT_LINKER_VERIFIED'
assert result['unique_cross_tu_candidates'] == resolved
assert result['ambiguous_or_missing'] == ambiguous
assert len(resolved) == 28 and not ambiguous
print(f'GE-04 cross-TU: {len(resolved)} unique-name candidates, {len(ambiguous)} ambiguous; linker verification pending')
