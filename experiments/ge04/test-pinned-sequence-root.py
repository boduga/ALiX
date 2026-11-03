#!/usr/bin/env python3
"""Root-gated independently pinned signed-sequence release verification."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 pinned sequence REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_integrated', Path(__file__).with_name('trusted-release-verification.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
with tempfile.TemporaryDirectory(prefix='ge04-pinned-sequence-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    config, release, floor = (root / name for name in ('config', 'release', 'floor'))
    for directory in (config, release, floor):
        directory.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    helper = b'GE04 integrated fixture'
    def protected(directory, name, data):
        path = directory / name
        path.write_bytes(data)
        path.chmod(0o400)
    protected(config, 'trust.json', json.dumps({'version': 1, 'trustedKeySha256': hashlib.sha256(key).hexdigest(), 'release': 'fixture'}).encode())
    protected(floor, 'floor.json', json.dumps({'version': 1, 'minimumSequence': 10}).encode())
    protected(release, 'trusted.pub', key)
    protected(release, 'helper', helper)
    def signed(sequence, signer_key=signer):
        manifest = json.dumps({'version': 2, 'release': 'fixture', 'platform': 'linux',
                               'helperSha256': hashlib.sha256(helper).hexdigest(), 'sequence': sequence}).encode()
        for name, data in (('manifest.json', manifest), ('manifest.sig', signer_key.sign(manifest))):
            path = release / name
            if path.exists():
                path.chmod(0o600)
            protected(release, name, data)
    signed(10)
    assert verifier.verify(config, release, 0, floor) == hashlib.sha256(helper).hexdigest()
    for candidate in (9,):
        signed(candidate)
        try:
            verifier.verify(config, release, 0, floor)
        except PermissionError:
            pass
        else:
            raise AssertionError('signed rollback accepted')
    attacker = Ed25519PrivateKey.generate()
    signed(99, attacker)
    try:
        verifier.verify(config, release, 0, floor)
    except (InvalidSignature, PermissionError, ValueError):
        pass
    else:
        raise AssertionError('attacker signed key accepted')
    signed(10)
    try:
        verifier.verify(config, release, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('sequenced release accepted without protected floor')
    advance_spec = importlib.util.spec_from_file_location('ge04_authorized_advance', Path(__file__).with_name('authorized-floor-advance.py'))
    advance_module = importlib.util.module_from_spec(advance_spec)
    advance_spec.loader.exec_module(advance_module)
    signed(11)
    assert advance_module.advance_verified(config, release, floor, 0) == 11
    assert json.loads((floor / 'floor.json').read_text())['minimumSequence'] == 11
    signed(10)
    try:
        advance_module.advance_verified(config, release, floor, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('old signed release advanced floor')
print('GE04 pinned sequence root PASS: independent key pin, signed floor advancement; downgrade and attacker key denied')
