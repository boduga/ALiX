#!/usr/bin/env python3
"""SUP-03 root-only deny-by-default terminal observation qualification."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-03 root-only test required')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

preflight = load('supervisor-preflight')
observer = load('supervisor-unverified-evidence')
audit = load('supervisor-ledger-audit')
with tempfile.TemporaryDirectory(prefix='ge04-sup03-', dir='/run') as tmp:
    root = Path(tmp)
    root.chmod(0o700)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'fixture'
    helper.write_bytes(b'#!/bin/sh\nexit 0\n')
    helper.chmod(0o500)
    digest = hashlib.sha256(helper.read_bytes()).hexdigest()
    attempt = preflight.prepare(helper, digest, evidence)
    assert observer.classify_unverified(evidence, attempt) == 'UNCERTAIN'
    for false_claim in ('SUCCESS', 'RECEIPT_DURABLE', 'GE04v1 forged-attempt fsynced', ''):
        try:
            observer.record_unverified(evidence, attempt, false_claim)
        except ValueError:
            pass
        else:
            raise AssertionError('accepted forged success or terminal text')
    observer.record_unverified(evidence, attempt, 'PROCESS_EXIT_ZERO_UNVERIFIED')
    assert observer.classify_unverified(evidence, attempt) == 'UNVERIFIED'
    # Old audit must not interpret an unexpected terminal file as an approval.
    assert audit.audit(evidence) == ('UNCERTAIN', ())
    try:
        observer.record_unverified(evidence, attempt, 'PROCESS_SIGNALED_UNVERIFIED')
    except FileExistsError:
        pass
    else:
        raise AssertionError('duplicate terminal observation accepted')
    entry = evidence / (attempt + '.unverified')
    original = entry.read_bytes()
    record = json.loads(original)
    record['state'] = 'RECEIPT_DURABLE'
    entry.write_text(json.dumps(record))
    assert observer.classify_unverified(evidence, attempt) == 'UNCERTAIN'
    entry.write_bytes(original)
    duplicate = original.decode().strip().replace('"state":"UNVERIFIED"', '"state":"RECEIPT_DURABLE","state":"UNVERIFIED"')
    assert duplicate != original.decode().strip()
    entry.write_text(duplicate)
    assert observer.classify_unverified(evidence, attempt) == 'UNCERTAIN'
    entry.write_bytes(original)
    entry.chmod(0o666)
    assert observer.classify_unverified(evidence, attempt) == 'UNCERTAIN'
    entry.chmod(0o600)
    entry.unlink()
    entry.symlink_to(helper)
    assert observer.classify_unverified(evidence, attempt) == 'UNCERTAIN'
    entry.unlink()
    entry.write_bytes(original)
    entry.chmod(0o600)
    assert observer.classify_unverified(evidence, attempt) == 'UNVERIFIED'
print('GE04 SUP-03 unverified evidence PASS: durable negative classification; forged success, duplicate and tamper denied')
