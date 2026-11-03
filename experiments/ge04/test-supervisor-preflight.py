#!/usr/bin/env python3
"""Adversarial smoke tests for isolated GE-04 pre-spawn preparation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

module_path = Path(__file__).with_name('supervisor-preflight.py')
spec = importlib.util.spec_from_file_location('ge04_preflight', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-supervisor-') as temp:
    root = Path(temp)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'helper'
    data = b'#!/bin/sh\nexit 0\n'
    helper.write_bytes(data)
    helper.chmod(0o500)
    pinned = hashlib.sha256(data).hexdigest()
    try:
        module.prepare(helper, '0' * 64, evidence)
        raise AssertionError('incorrect digest accepted')
    except PermissionError:
        pass
    assert not list(evidence.iterdir()), 'digest rejection wrote evidence'
    helper.chmod(0o700)
    try:
        module.prepare(helper, pinned, evidence)
        raise AssertionError('writable helper accepted')
    except PermissionError:
        pass
    assert not list(evidence.iterdir()), 'writable helper wrote evidence'
    helper.chmod(0o500)
    link = root / 'link'
    link.symlink_to(helper)
    try:
        module.prepare(link, pinned, evidence)
        raise AssertionError('symlink accepted')
    except OSError:
        pass
    assert not list(evidence.iterdir()), 'symlink rejection wrote evidence'
    attempt = module.prepare(helper, pinned, evidence)
    files = list(evidence.iterdir())
    assert len(files) == 1 and files[0].name == attempt + '.json'
    record = json.loads(files[0].read_text())
    assert record['state'] == 'pre_spawn' and record['admission'] == 'NOT_AUTHORIZED'
    assert record['helperSha256'] == pinned and record['attemptId'] == attempt
    assert files[0].stat().st_mode & 0o077 == 0
    assert not (root / 'created.txt').exists()
    print('GE-04 supervisor preflight PASS: mismatch, writable, symlink denial; fsynced pre-spawn only')
