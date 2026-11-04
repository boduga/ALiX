#!/usr/bin/env python3
"""GE-04 SUP-05 experimental signed claim matcher; NEVER admission.

The independent key pin, policy state and clock here are caller-provided test
inputs, NOT supervisor-controlled production authority. No claim grants mutation.
"""
import hashlib
import json
import re

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

SHA = re.compile(r'^[0-9a-f]{64}$')
IDENT = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$')
CLAIM_KEYS = frozenset({
    'version', 'attemptId', 'approvalId', 'leaseId', 'workerId',
    'policyRevision', 'invocationSha256', 'ownedPath',
    'nonce', 'issuedAtMs', 'expiresAtMs'
})


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate claim key')
        result[key] = value
    return result


def match_signed_claim(message: bytes, signature: bytes, public_key: bytes,
                       trusted_key_sha256: str, expected: dict,
                       now_ms: int, revoked: bool = False) -> str:
    """Return only TEST_MATCH_UNTRUSTED, never an admission/receipt."""
    if (type(message) is not bytes or not 0 < len(message) <= 4096 or
            type(signature) is not bytes or len(signature) != 64 or
            type(public_key) is not bytes or len(public_key) != 32 or
            type(trusted_key_sha256) is not str or not SHA.fullmatch(trusted_key_sha256)):
        raise ValueError('malformed signed authority envelope')
    if hashlib.sha256(public_key).hexdigest() != trusted_key_sha256:
        raise PermissionError('untrusted authority signing key')
    Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
    claim = json.loads(message, object_pairs_hook=_unique)
    if type(claim) is not dict or set(claim) != CLAIM_KEYS or type(claim['version']) is not int or claim['version'] != 1:
        raise ValueError('invalid claim schema')
    for field in ('attemptId', 'approvalId', 'leaseId', 'workerId', 'nonce'):
        if type(claim[field]) is not str or not IDENT.fullmatch(claim[field]):
            raise ValueError('invalid identity: ' + field)
    if type(claim['invocationSha256']) is not str or not SHA.fullmatch(claim['invocationSha256']):
        raise ValueError('invalid invocation digest')
    if (type(claim['policyRevision']) is not int or claim['policyRevision'] < 0 or
            type(claim['issuedAtMs']) is not int or type(claim['expiresAtMs']) is not int or
            type(now_ms) is not int or claim['issuedAtMs'] < 0 or
            claim['expiresAtMs'] <= claim['issuedAtMs'] or
            claim['expiresAtMs'] - claim['issuedAtMs'] > 300_000 or
            not claim['issuedAtMs'] <= now_ms < claim['expiresAtMs']):
        raise PermissionError('invalid or expired authority window')
    path = claim['ownedPath']
    if (type(path) is not str or len(path) > 1024 or not path.startswith('/') or
            '\x00' in path or any(part in ('', '.', '..') for part in path.split('/')[1:])):
        raise ValueError('invalid owned path')
    if type(revoked) is not bool or revoked:
        raise PermissionError('lease revoked or revocation state unknown')
    if type(expected) is not dict or set(expected) != (CLAIM_KEYS - {'version', 'nonce', 'issuedAtMs', 'expiresAtMs'}):
        raise ValueError('expected authority binding is incomplete')
    for field, want in expected.items():
        if type(want) is not type(claim[field]) or claim[field] != want:
            raise PermissionError('authority binding mismatch: ' + field)
    return 'TEST_MATCH_UNTRUSTED'
