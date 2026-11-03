#!/usr/bin/env python3
"""Root-only fail-closed supervisor pre-spawn ledger recovery fixture."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 supervisor ledger REQUIRES root (not a pass)')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

preflight = load('supervisor-preflight')
recovery = load('supervisor-ledger-reconcile')
with tempfile.TemporaryDirectory(prefix='ge04-ledger-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'helper'
    helper.write_bytes(b'#!/bin/sh\nexit 0\n')
    helper.chmod(0o500)
    attempt = preflight.prepare(helper, hashlib.sha256(helper.read_bytes()).hexdigest(), evidence)
    entry = evidence / (attempt + '.json')
    assert recovery.classify(evidence, attempt) == 'NOT_AUTHORIZED'
    assert recovery.classify(evidence, '../' + attempt) == 'UNCERTAIN'
    assert recovery.classify(evidence, '00000000-0000-4000-8000-000000000000') == 'UNCERTAIN'
    original = entry.read_bytes()
    record = json.loads(original)
    record['admission'] = 'AUTHORIZED'
    entry.write_text(json.dumps(record))
    assert recovery.classify(evidence, attempt) == 'UNCERTAIN', 'forged admission recognized'
    entry.write_bytes(original)
    entry.chmod(0o666)
    assert recovery.classify(evidence, attempt) == 'UNCERTAIN', 'writable ledger accepted'
    entry.chmod(0o600)
    entry.unlink()
    entry.symlink_to(helper)
    assert recovery.classify(evidence, attempt) == 'UNCERTAIN', 'symlink accepted'
print('GE04 supervisor ledger root PASS: pre-spawn only, forged admission and tampering quarantined')
