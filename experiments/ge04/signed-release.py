#!/usr/bin/env python3
"""Isolated GE-04 Ed25519 release verification. No helper execution/admission.

Requires cryptography in the test environment. Public key trust is provisioned
outside this script; accepting a caller-selected key is NOT production trust.
"""
import argparse
import hashlib
import json
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def verify_release(manifest_bytes: bytes, signature: bytes, pinned_public_key: bytes,
                   helper_bytes: bytes, expected_release: str) -> str:
    if len(manifest_bytes) > 4096 or len(signature) != 64 or len(pinned_public_key) != 32:
        raise ValueError('invalid release envelope size')
    try:
        Ed25519PublicKey.from_public_bytes(pinned_public_key).verify(signature, manifest_bytes)
    except InvalidSignature as exc:
        raise PermissionError('GE04 release signature invalid') from exc
    record = json.loads(manifest_bytes)
    if set(record) != {'version', 'release', 'helperSha256', 'platform'} or record['version'] != 1:
        raise ValueError('invalid signed release schema')
    digest = record['helperSha256']
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('invalid signed digest')
    if record['platform'] != 'linux' or record['release'] != expected_release:
        raise PermissionError('wrong release identity or platform')
    if hashlib.sha256(helper_bytes).hexdigest() != digest:
        raise PermissionError('helper does not match signed release')
    return digest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--signature', type=Path, required=True)
    parser.add_argument('--trusted-public-key', type=Path, required=True)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--release', required=True)
    args = parser.parse_args()
    print(verify_release(args.manifest.read_bytes(), args.signature.read_bytes(),
                         args.trusted_public_key.read_bytes(), args.helper.read_bytes(), args.release))
