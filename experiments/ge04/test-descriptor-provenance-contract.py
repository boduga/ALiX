#!/usr/bin/env python3
"""SUP-16 negative contract checks; no OS authority or real identity."""
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location(
    'ge04_sup16', Path(__file__).with_name('descriptor-provenance-contract.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

base = dict(version=1, originPid=100, currentHolderPid=100,
            delegated=False, identityFresh=True, rolePinned=True)
assert module.classify_descriptor(base) == 'SAME_HOLDER_CLAIM_UNTRUSTED'
for changes in [
    {'delegated': True}, {'currentHolderPid': 101},
    {'identityFresh': False}, {'rolePinned': False},
    {'currentHolderPid': 0}, {'originPid': -1},
    {'delegated': 1}, {'version': True},
    {'originPid': '100'}, {'rolePinned': 'yes'}
]:
    evidence = {**base, **changes}
    assert module.classify_descriptor(evidence) == 'UNVERIFIED', changes
assert module.classify_descriptor({}) == 'UNVERIFIED'
assert module.classify_descriptor({**base, 'extra': True}) == 'UNVERIFIED'
assert module.classify_descriptor(None) == 'UNVERIFIED'
assert module.classify_descriptor('trusted') == 'UNVERIFIED'
print('GE04 SUP-16 provenance contract PASS: delegated and unverifiable holders denied; no OS enforcement claimed')
