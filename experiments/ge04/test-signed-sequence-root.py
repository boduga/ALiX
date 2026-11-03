#!/usr/bin/env python3
"""Root-only signed sequence floor binding adversarial test."""
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
    raise SystemExit('GE04 signed sequence REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_signed_sequence', Path(__file__).with_name('signed-sequence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-sequence-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    floor = root / 'floor'
    floor.mkdir(mode=0o700)
    record = floor / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 20}))
    record.chmod(0o400)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    helper = b'GE04 signed sequence helper'
    def signed(seq):
        raw = json.dumps({'version': 2, 'release': 'fixture', 'platform': 'linux',
                          'helperSha256': hashlib.sha256(helper).hexdigest(), 'sequence': seq}).encode()
        return raw, signer.sign(raw)
    manifest, signature = signed(20)
    assert module.verify(manifest, signature, key, helper, 'fixture', floor, 0) == hashlib.sha256(helper).hexdigest()
    for candidate in (19, True, -1):
        raw, sig = signed(candidate)
        try:
            module.verify(raw, sig, key, helper, 'fixture', floor, 0)
        except (ValueError, PermissionError):
            pass
        else:
            raise AssertionError('invalid or below-floor signed sequence accepted')
    forged = json.loads(manifest)
    forged['sequence'] = 999
    try:
        module.verify(json.dumps(forged).encode(), signature, key, helper, 'fixture', floor, 0)
    except InvalidSignature:
        pass
    else:
        raise AssertionError('unsigned sequence substitution accepted')
print('GE04 signed sequence root PASS: signed floor accepted; downgrade and forged sequence denied')
