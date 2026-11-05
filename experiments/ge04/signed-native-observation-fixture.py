#!/usr/bin/env python3
"""GE-04 root-custodied signed observation fixture; NOT trusted effect proof.

A distinct-UID requester can verify this Ed25519 signature without possessing
the signing key. Root fixture custody is NOT an independent trust root and
signing an observation is NOT attesting that a kernel effect truly occurred.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PRIVATE = 'native-fixture-signing.key'
PUBLIC = 'native-fixture-signing.pub'
RECEIPT = 'native-fixture-signed-observation.json'
DOMAIN = b'GE04-ROOT-CUSTODIED-NATIVE-FIXTURE-V1\x00'
FIELDS = {'version', 'attempt', 'approval', 'lease', 'policyRevision',
          'observationSha256', 'effectSha256', 'signerKeySha256', 'status'}
ENVELOPE_FIELDS = {'payload', 'signature'}


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _read(fd, name, owner, max_size, mode):
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        s = os.fstat(handle)
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != owner or
                s.st_nlink != 1 or s.st_mode & 0o777 != mode or
                not 0 < s.st_size <= max_size):
            raise PermissionError('untrusted signing fixture file')
        raw = os.read(handle, max_size + 1)
        if len(raw) != s.st_size:
            raise PermissionError('partial signing fixture file')
        return raw
    finally:
        os.close(handle)


def _write_once(fd, name, data, mode):
    handle = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=fd)
    try:
        if os.write(handle, data) != len(data):
            raise OSError('partial fixture record')
        os.fsync(handle)
    finally:
        os.close(handle)
    os.fsync(fd)


def provision(private, public):
    if os.geteuid() != 0:
        raise PermissionError('fixture key provision requires root')
    privfd = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    pubfd = os.open(public, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for fd, expected in ((privfd, 0o700), (pubfd, 0o755)):
            s = os.fstat(fd)
            if s.st_uid != 0 or s.st_mode & 0o777 != expected:
                raise PermissionError('unsafe signing fixture directory')
        signing = Ed25519PrivateKey.generate()
        raw_private = signing.private_bytes(serialization.Encoding.Raw,
                                            serialization.PrivateFormat.Raw,
                                            serialization.NoEncryption())
        raw_public = signing.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        _write_once(privfd, PRIVATE, raw_private, 0o600)
        _write_once(pubfd, PUBLIC, raw_public, 0o644)
        return hashlib.sha256(raw_public).hexdigest()
    finally:
        os.close(pubfd)
        os.close(privfd)


def sign_observation(private, public, state, observation_bytes, effect_digest, pinned_key_digest):
    """Sign only a fixture observation AFTER local state is settled.

    This does NOT verify helper identity or actual native effect; the caller
    supplies observation bytes. A privileged caller can fabricate them.
    """
    if os.geteuid() != 0 or not isinstance(state, dict):
        raise PermissionError('only privileged fixture may sign')
    if (state.get('approvalState') != 'consumed' or state.get('inFlight') is not None or
            state.get('consumed') != ['fixed-kernel-attempt'] or
            state.get('approvalId') != 'approval' or state.get('leaseId') != 'lease' or
            type(state.get('policyRevision')) is not int or
            state.get('policyRevision') != 7 or state.get('revoked') is not False):
        raise PermissionError('unsettled or invalid fixture authority')
    if (type(effect_digest) is not str or len(effect_digest) != 64 or
            any(c not in '0123456789abcdef' for c in effect_digest) or
            type(observation_bytes) is not bytes or not observation_bytes or
            len(observation_bytes) > 2048):
        raise ValueError('invalid observation input')
    privfd = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    pubfd = os.open(public, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if os.fstat(privfd).st_uid != 0 or os.fstat(privfd).st_mode & 0o777 != 0o700:
            raise PermissionError('unprotected signer directory')
        if os.fstat(pubfd).st_uid != 0 or os.fstat(pubfd).st_mode & 0o777 != 0o755:
            raise PermissionError('unprotected public verification directory')
        secret = _read(privfd, PRIVATE, 0, 32, 0o600)
        public_key = _read(pubfd, PUBLIC, 0, 32, 0o644)
        if hashlib.sha256(public_key).hexdigest() != pinned_key_digest:
            raise PermissionError('untrusted signing key')
        signing = Ed25519PrivateKey.from_private_bytes(secret)
        if signing.public_key().public_bytes(serialization.Encoding.Raw,
                serialization.PublicFormat.Raw) != public_key:
            raise PermissionError('key pair mismatch')
        payload = {'version': 1, 'attempt': 'fixed-kernel-attempt',
                   'approval': 'approval', 'lease': 'lease', 'policyRevision': 7,
                   'observationSha256': hashlib.sha256(observation_bytes).hexdigest(),
                   'effectSha256': effect_digest, 'signerKeySha256': pinned_key_digest,
                   'status': 'NATIVE_FIXTURE_OBSERVED_UNVERIFIED'}
        signature = signing.sign(DOMAIN + canonical(payload)).hex()
        _write_once(pubfd, RECEIPT, canonical({'payload': payload, 'signature': signature}) + b'\n', 0o644)
        return 'GE04_SIGNED_FIXTURE_OBSERVATION_PERSISTED_UNVERIFIED'
    finally:
        os.close(pubfd)
        os.close(privfd)


def verify_observation(public, trusted_key_digest, expected_observation_sha256,
                       expected_effect_sha256):
    """Public verification: SIGNATURE VALID != NATIVE EFFECT VERIFIED."""
    try:
        fd = os.open(public, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            st = os.fstat(fd)
            if st.st_uid != 0 or st.st_mode & 0o022:
                return 'UNCERTAIN_NO_REPLAY'
            key = _read(fd, PUBLIC, 0, 32, 0o644)
            if hashlib.sha256(key).hexdigest() != trusted_key_digest:
                return 'UNCERTAIN_NO_REPLAY'
            raw = _read(fd, RECEIPT, 0, 2048, 0o644)
        finally:
            os.close(fd)
        def unique(pairs):
            out = {}
            for name, value in pairs:
                if name in out:
                    raise ValueError('duplicate field')
                out[name] = value
            return out
        envelope = json.loads(raw, object_pairs_hook=unique)
        if (type(envelope) is not dict or set(envelope) != ENVELOPE_FIELDS or
                type(envelope['payload']) is not dict or
                set(envelope['payload']) != FIELDS or
                type(envelope['signature']) is not str):
            return 'UNCERTAIN_NO_REPLAY'
        payload = envelope['payload']
        if (type(payload['version']) is not int or payload['version'] != 1 or
                type(payload['policyRevision']) is not int or payload['policyRevision'] != 7 or
                any(type(payload[k]) is not str for k in FIELDS - {'version', 'policyRevision'}) or
                payload['attempt'] != 'fixed-kernel-attempt' or
                payload['approval'] != 'approval' or payload['lease'] != 'lease' or
                payload['status'] != 'NATIVE_FIXTURE_OBSERVED_UNVERIFIED' or
                payload['signerKeySha256'] != trusted_key_digest or
                payload['observationSha256'] != expected_observation_sha256 or
                payload['effectSha256'] != expected_effect_sha256):
            return 'UNCERTAIN_NO_REPLAY'
        Ed25519PublicKey.from_public_bytes(key).verify(
            bytes.fromhex(envelope['signature']), DOMAIN + canonical(payload))
        return 'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED'
    except (OSError, ValueError, KeyError, TypeError, PermissionError, InvalidSignature):
        return 'UNCERTAIN_NO_REPLAY'
