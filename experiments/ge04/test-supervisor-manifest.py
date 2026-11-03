#!/usr/bin/env python3
"""Negative tests for experimental supervisor-owned manifest preflight."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('ge04_manifest', Path(__file__).with_name('supervisor-manifest.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-manifest-') as tmp:
    root = Path(tmp)
    manifest_dir = root / 'manifest'
    manifest_dir.mkdir(mode=0o700)
    evidence = root / 'evidence'
    evidence.mkdir(mode=0o700)
    helper = root / 'helper'
    helper.write_bytes(b'#!/bin/sh\nexit 0\n')
    helper.chmod(0o500)
    digest = hashlib.sha256(helper.read_bytes()).hexdigest()
    manifest = manifest_dir / 'helper.json'
    manifest.write_text(json.dumps({'version': 1, 'helperSha256': digest}))
    manifest.chmod(0o400)
    assert module.pinned_digest(manifest_dir) == digest
    attempt = module.prepare_from_manifest(helper, manifest_dir, evidence)
    assert json.loads((evidence / (attempt + '.json')).read_text())['admission'] == 'NOT_AUTHORIZED'
    manifest.unlink()
    manifest.symlink_to(helper)
    try:
        module.pinned_digest(manifest_dir)
        raise AssertionError('symlink manifest accepted')
    except OSError:
        pass
    manifest.unlink()
    manifest.write_text(json.dumps({'version': 1, 'helperSha256': '0' * 64}))
    manifest.chmod(0o400)
    try:
        module.prepare_from_manifest(helper, manifest_dir, evidence)
        raise AssertionError('wrong manifest digest accepted')
    except PermissionError:
        pass
    assert len(list(evidence.iterdir())) == 1
    manifest_dir.chmod(0o777)
    try:
        module.pinned_digest(manifest_dir)
        raise AssertionError('world-writable manifest directory accepted')
    except PermissionError:
        pass
    print('GE04 protected-manifest prototype PASS: pinned digest, symlink, mismatch, unsafe directory denied')
