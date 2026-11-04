#!/usr/bin/env python3
"""GE04 SUP-02 isolated atomic child identity test. No production helper."""
import pathlib
import subprocess
import sys
import tempfile

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-02 requires Linux (no skip-as-pass)')
source = pathlib.Path(__file__).with_name('clone3-pidfd-probe.c')
with tempfile.TemporaryDirectory(prefix='ge04-sup02-') as tmp:
    program = pathlib.Path(tmp) / 'pidfd-test'
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror',
                    str(source), '-o', str(program)], check=True, timeout=15)
    expected = {
        'zero': 'GE04 PROCESS_EXIT_ZERO_UNVERIFIED',
        'early': 'GE04 PROCESS_EXIT_ZERO_UNVERIFIED',
        'invalid': 'GE04 PROCESS_EXIT_ZERO_UNVERIFIED',
        'nonzero': 'GE04 PROCESS_EXIT_NONZERO_UNVERIFIED',
        'kill': 'GE04 PROCESS_SIGNALED_UNVERIFIED',
        'forged': 'GE04 PROCESS_EXIT_ZERO_UNVERIFIED',
    }
    for mode, label in expected.items():
        result = subprocess.run([str(program), mode], capture_output=True, text=True, timeout=10)
        assert result.returncode == 0, (mode, result.stderr)
        assert label in result.stdout, (mode, result.stdout)
        assert 'AUTHORIZED' not in result.stdout, (mode, result.stdout)
        assert 'RECEIPT_DURABLE' not in result.stdout, (mode, result.stdout)
        if mode == 'forged':
            assert 'GE04v1 forged-attempt fsynced' in result.stdout
            assert 'UNVERIFIED' in result.stdout
    denied = subprocess.run([str(program), 'unsupported'], capture_output=True, text=True, timeout=10)
    assert denied.returncode == 77
    assert 'ATOMIC_PIDFD_UNAVAILABLE' in denied.stderr
    unknown = subprocess.run([str(program), 'unknown'], capture_output=True, text=True, timeout=10)
    assert unknown.returncode == 2

print('GE04 SUP-02 pidfd lifecycle PASS: atomic child identity; normal/nonzero/signal/early/forged/invalid/unavailable')
