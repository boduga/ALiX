#!/usr/bin/env python3
"""GE04 SUP-05 signed authority claim negative-path fixture. Never admission."""
import hashlib
import importlib.util
import json
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

spec = importlib.util.spec_from_file_location('ge04_claim', Path(__file__).with_name('signed-authority-claim.py'))
matcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matcher)
signer = Ed25519PrivateKey.generate()
public = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
pin = hashlib.sha256(public).hexdigest()
other_signer = Ed25519PrivateKey.generate()
other_key = other_signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
claim = {
    'version': 1, 'attemptId': 'attempt-1', 'approvalId': 'approval-1',
    'leaseId': 'lease-1', 'workerId': 'worker-1',
    'policyRevision': 15, 'invocationSha256': hashlib.sha256(b'file.create:fixture').hexdigest(),
    'ownedPath': '/authorized/test-file', 'nonce': 'nonce-1',
    'issuedAtMs': 100000, 'expiresAtMs': 110000
}
expected = {key: value for key, value in claim.items()
            if key not in ('version', 'nonce', 'issuedAtMs', 'expiresAtMs')}

def encode(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()

def accept(obj=claim, *, when=105000, key=public, keypin=pin, current=expected, revoked=False):
    raw = encode(obj)
    return matcher.match_signed_claim(raw, signer.sign(raw), key, keypin, current, when, revoked)

def denied(action, label):
    try:
        action()
    except (PermissionError, ValueError, TypeError, InvalidSignature):
        return
    raise AssertionError('unsafe authority claim accepted: ' + label)

assert accept() == 'TEST_MATCH_UNTRUSTED'
# The same signed claim matches again: no replay protection is claimed.
assert accept() == 'TEST_MATCH_UNTRUSTED'
for field, alternate in [
    ('attemptId', 'attempt-2'), ('approvalId', 'approval-2'),
    ('leaseId', 'lease-2'), ('workerId', 'worker-2'),
    ('policyRevision', 16), ('invocationSha256', 'f' * 64),
    ('ownedPath', '/authorized/other-file')
]:
    changed = dict(expected)
    changed[field] = alternate
    denied(lambda changed=changed: accept(current=changed), 'mismatched ' + field)
denied(lambda: accept(when=110000), 'expired')
denied(lambda: accept(when=99999), 'not yet issued')
denied(lambda: accept(revoked=True), 'revoked')
denied(lambda: accept(revoked=None), 'unknown revocation')
denied(lambda: accept(key=other_key), 'substituted signing key')
denied(lambda: accept(key=other_key, keypin=hashlib.sha256(other_key).hexdigest()), 'mismatched key/signature')
denied(lambda: accept(keypin='f' * 64), 'attacker signing pin')
denied(lambda: accept(current={}), 'partial authority expected binding')
for field, alternate in [
    ('version', True), ('policyRevision', True), ('issuedAtMs', True),
    ('expiresAtMs', 400001), ('ownedPath', '/allowed/../escape'),
    ('invocationSha256', 'NOT_A_DIGEST'), ('nonce', '')
]:
    forged = dict(claim)
    forged[field] = alternate
    denied(lambda forged=forged: accept(forged), 'invalid ' + field)
raw = encode(claim)
duplicate = raw.replace(b'"version":1', b'"version":2,"version":1')
assert duplicate != raw
denied(lambda: matcher.match_signed_claim(duplicate, signer.sign(duplicate),
                                            public, pin, expected, 105000), 'duplicate key')
denied(lambda: matcher.match_signed_claim(raw, b'0' * 64, public, pin, expected, 105000),
       'invalid signature')
print('GE04 SUP-05 signed claim matching PASS: exact binding, signature, expiry and revocation fail closed')
