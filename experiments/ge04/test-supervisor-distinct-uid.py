#!/usr/bin/env python3
"""Root-gated GE-04 supervisor preflight evidence isolation proof.

Run only in an explicitly privileged CI job; never attempts elevation.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 root-gated isolation test REQUIRES root (not a pass)')

spec = importlib.util.spec_from_file_location('ge04_preflight', Path(__file__).with_name('supervisor-preflight.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-uid-isolation-') as temp:
    root = Path(temp)
    root.chmod(0o755)  # Worker can traverse root: evidence denial must be its own mode boundary.
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'helper'
    data = b'#!/bin/sh\nexit 0\n'
    helper.write_bytes(data)
    helper.chmod(0o500)
    attempt = module.prepare(helper, hashlib.sha256(data).hexdigest(), evidence)
    record = evidence / (attempt + '.json')
    assert json.loads(record.read_text())['admission'] == 'NOT_AUTHORIZED'
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
            assert os.geteuid() == 65534
            denied = 0
            for action in (
                lambda: record.read_bytes(),
                lambda: record.write_bytes(b'forged'),
                lambda: (evidence / 'forged.json').write_bytes(b'forged'),
                lambda: record.unlink(),
            ):
                try:
                    action()
                except PermissionError:
                    denied += 1
            os._exit(0 if denied == 4 else 1)
        except BaseException:
            os._exit(2)
    _, status = os.waitpid(pid, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, 'worker gained evidence access'
    assert json.loads(record.read_text())['admission'] == 'NOT_AUTHORIZED'
    assert sorted(p.name for p in evidence.iterdir()) == [record.name]
    print('GE04 distinct-UID supervisor evidence denial PASS: real UID 65534 denied read/write/create/delete')
