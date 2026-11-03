#!/usr/bin/env python3
"""GE04 Ed25519 trust-anchor adversarial tests; ephemeral keys only."""
import hashlib
import importlib.util
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

spec = importlib.util.spec_from_file_location('ge04_signed_release', Path(__file__).with_name('signed-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

trusted = Ed25519PrivateKey.generate()
attacker = Ed25519PrivateKey.generate()
public = trusted.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
helper = b'GE04 test executable bytes'
digest = hashlib.sha256(helper).hexdigest()
manifest = json.dumps({'version': 1, 'release': 'test-release-1', 'platform': 'linux',
                       'helperSha256': digest}, sort_keys=True, separators=(',', ':')).encode()
signature = trusted.sign(manifest)
assert module.verify_release(manifest, signature, public, helper, 'test-release-1') == digest

def denied(manifest_bytes, sig, key, data, release):
    try:
        module.verify_release(manifest_bytes, sig, key, data, release)
    except (PermissionError, ValueError):
        return
    raise AssertionError('untrusted release accepted')

denied(manifest, attacker.sign(manifest), public, helper, 'test-release-1')
denied(manifest, signature, public, b'substituted helper', 'test-release-1')
denied(manifest, signature, public, helper, 'test-release-0')
forged = json.dumps({'version': 1, 'release': 'test-release-1', 'platform': 'linux',
                     'helperSha256': hashlib.sha256(b'substituted helper').hexdigest()},
                    sort_keys=True, separators=(',', ':')).encode()
denied(forged, signature, public, b'substituted helper', 'test-release-1')
denied(manifest, attacker.sign(manifest), public, helper, 'test-release-1')
print('GE04 signed release PASS: valid signature; forged signer, modified manifest, binary, replay release denied')
