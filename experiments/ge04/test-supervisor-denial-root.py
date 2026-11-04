#!/usr/bin/env python3
"""Root-only durable deny-only transition smoke test; no execution."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 denial transition REQUIRES root (not a pass)')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

preflight = load('supervisor-preflight')
journal = load('supervisor-transition-journal')
recovery = load('supervisor-denial-reconcile')
with tempfile.TemporaryDirectory(prefix='ge04-denial-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'helper'
    helper.write_bytes(b'#!/bin/sh\nexit 0\n')
    helper.chmod(0o500)
    attempt = preflight.prepare(helper, hashlib.sha256(helper.read_bytes()).hexdigest(), evidence)
    journal.append_denial(evidence, attempt, 'operator_denied')
    denied = evidence / (attempt + '.denied')
    record = json.loads(denied.read_bytes())
    assert record['state'] == 'DENIED' and record['attemptId'] == attempt
    assert record['preSpawnSha256'] == hashlib.sha256((evidence / (attempt + '.json')).read_bytes()).hexdigest()
    try:
        journal.append_denial(evidence, attempt, 'replayed')
    except FileExistsError:
        pass
    else:
        raise AssertionError('duplicate denial overwrote protected journal')
    assert json.loads(denied.read_bytes())['reason'] == 'operator_denied'
    assert recovery.reconcile(evidence, attempt) == 'DENIED'
    original = denied.read_bytes()
    denied.write_bytes(b'{torn')
    assert recovery.reconcile(evidence, attempt) == 'UNCERTAIN', 'torn denial accepted'
    denied.write_bytes(original)
    forged = json.loads(original)
    forged['preSpawnSha256'] = '0' * 64
    denied.write_text(json.dumps(forged))
    assert recovery.reconcile(evidence, attempt) == 'UNCERTAIN', 'wrong predecessor digest accepted'
    denied.write_bytes(original)
    denied.unlink()
    assert recovery.reconcile(evidence, attempt) == 'UNCERTAIN', 'missing denial accepted'
    assert not (root / 'created.txt').exists()
print('GE04 supervisor denial root PASS: fsynced deny-only transition, replay denied, no execution')
