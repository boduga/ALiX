#!/usr/bin/env python3
"""GE04 experimental Ed25519 signed sequence and protected floor gate."""
import hashlib
import importlib.util
import json
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(manifest, signature, key, helper, expected_release, floor_directory, owner_uid=0):
    if len(manifest) > 4096 or len(signature) != 64 or len(key) != 32:
        raise ValueError('invalid signed envelope')
    Ed25519PublicKey.from_public_bytes(key).verify(signature, manifest)
    record = json.loads(manifest)
    if (set(record) != {'version', 'release', 'platform', 'helperSha256', 'sequence'} or
            type(record['version']) is not int or record['version'] != 2 or
            record['platform'] != 'linux' or record['release'] != expected_release):
        raise PermissionError('invalid signed release identity or schema')
    sequence = record['sequence']
    if type(sequence) is not int or not 0 <= sequence <= 2**63 - 1:
        raise ValueError('invalid signed sequence')
    digest = record['helperSha256']
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('invalid signed helper digest')
    if hashlib.sha256(helper).hexdigest() != digest:
        raise PermissionError('helper digest mismatch')
    floor = load('release-floor')
    floor.verify_floor(floor_directory, sequence, owner_uid)
    return digest
