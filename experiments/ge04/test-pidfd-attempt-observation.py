#!/usr/bin/env python3
"""SUP-04: kernel-observed child -> attempt-bound, non-authorizing evidence."""
import hashlib
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-04 requires Linux')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

with tempfile.TemporaryDirectory(prefix='ge04-sup04-') as temp:
    root = Path(temp)
    root.chmod(0o700)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'inert'
    helper.write_bytes(b'harmless test fixture (never executed)')
    helper.chmod(0o400)
    preflight = load('supervisor-preflight')
    audit = load('supervisor-ledger-audit')
    binary = root / 'supervisor'
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror',
                    str(Path(__file__).with_name('pidfd-attempt-observation.c')),
                    '-o', str(binary)], check=True, timeout=15)

    def attempt():
        return preflight.prepare(helper, hashlib.sha256(helper.read_bytes()).hexdigest(), evidence)

    def invoke(a, mode):
        return subprocess.run([str(binary), str(evidence), a, mode],
                              capture_output=True, text=True, timeout=10)

    for mode, outcome in [
        ('zero', 'PROCESS_EXIT_ZERO_UNVERIFIED'),
        ('nonzero', 'PROCESS_EXIT_NONZERO_UNVERIFIED'),
        ('kill', 'PROCESS_SIGNALED_UNVERIFIED'),
        ('forged', 'PROCESS_EXIT_ZERO_UNVERIFIED'),
    ]:
        a = attempt()
        result = invoke(a, mode)
        assert result.returncode == 0, (mode, result.returncode, result.stderr)
        record = (evidence / (a + '.pidfd-unverified')).read_text()
        assert 'attempt=' + a in record
        assert 'outcome=' + outcome in record
        assert 'admission=NOT_AUTHORIZED' in record
        assert not re.search(r'outcome=(?:SUCCESS|RECEIPT_DURABLE)', record)
        if mode == 'forged':
            assert 'RECEIPT_DURABLE SUCCESS fsynced' in result.stdout
            assert 'RECEIPT_DURABLE' not in record
        assert audit.audit(evidence) == ('UNCERTAIN', ())
        duplicate = invoke(a, mode)
        assert duplicate.returncode != 0, 'duplicate record overwritten'

    # Two independent supervisors contest one attempt: only one may spawn.
    contested = attempt()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: invoke(contested, 'zero').returncode, range(2)))
    assert sorted(results) == [0, 6], results
    assert (evidence / (contested + '.pidfd-started')).exists()
    assert (evidence / (contested + '.pidfd-unverified')).exists()

    a = attempt()
    assert invoke('../' + a, 'zero').returncode != 0, 'path traversal accepted'
    assert invoke('00000000-0000-4000-8000-000000000000', 'zero').returncode != 0, 'unknown attempt accepted'
    assert invoke(a, 'unsupported').returncode == 77
    assert not (evidence / (a + '.pidfd-unverified')).exists()
    assert invoke(a, 'crash-before-record').returncode == 88
    assert not (evidence / (a + '.pidfd-unverified')).exists()
    # No record must never become a success proof.
    assert load('supervisor-unverified-evidence').classify_unverified(evidence, a, os.geteuid()) == 'UNCERTAIN'
    assert (evidence / (a + '.pidfd-started')).exists()
    assert invoke(a, 'zero').returncode != 0, 'crashed reservation was replayed'
    assert not (evidence / (a + '.pidfd-unverified')).exists()

print('GE04 SUP-04 pidfd attempt binding PASS: observed exits; duplicate, spoof, invalid and crash denied')
