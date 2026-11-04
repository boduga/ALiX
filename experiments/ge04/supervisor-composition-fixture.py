#!/usr/bin/env python3
"""GE-04 SUP-08 inert composition fixture: no authorization or helper dispatch.

Composes the SUP-05 signature matcher, SUP-06 nonce reservation, and SUP-07
cooperative simulation. Caller controls all trust parameters. This is *not*
a trusted supervisor, receipt issuer or production execution path.
"""
import importlib.util
import json
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'),
                                                  Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def simulate(root: Path, message: bytes, signature: bytes, public_key: bytes,
             pinned_key_sha256: str, expected: dict, now_ms: int,
             revoked: bool, owner_uid: int = 0,
             fixture_crash_after_reservation: bool = False,
             fixture_crash_after_fence_prepare: bool = False) -> str:
    """Bind fixture stages; never return authorized/success.

    Once a nonce is reserved, EVERY subsequent error is ambiguous.
    The caller must quarantine the attempt and must not retry.
    """
    claims = load('signed-authority-claim')
    reservations = load('single-use-claim-reservation')
    fence = load('cooperative-revocation-fence')
    try:
        claim = json.loads(message)
    except (ValueError, TypeError) as exc:
        raise PermissionError('malformed fixture envelope') from exc
    if claims.match_signed_claim(message, signature, public_key, pinned_key_sha256,
                                 expected, now_ms, revoked) != 'TEST_MATCH_UNTRUSTED':
        raise PermissionError('fixture claim did not match')
    if type(claim) is not dict or type(expected) is not dict:
        raise PermissionError('invalid fixture claim')
    if (claim['attemptId'] != expected['attemptId'] or
            claim['leaseId'] != expected['leaseId'] or
            claim['policyRevision'] != expected['policyRevision']):
        raise PermissionError('incomplete fixture binding')
    result = reservations.reserve_claim(root / 'claims', message, signature,
                                        public_key, pinned_key_sha256, expected,
                                        now_ms, revoked, owner_uid,
                                        fixture_crash_after_reservation)
    if result != 'TEST_RESERVED_UNTRUSTED':
        raise PermissionError('fixture reservation not verified')
    # SUP-07 independently reloads the latest fixture lease and revision under
    # the cross-process lock. Any intervening revocation must win or wait.
    return fence.fixture_mutation(root / 'fence', claim['attemptId'],
                                  claim['leaseId'], claim['policyRevision'], now_ms,
                                  crash_after_prepare=fixture_crash_after_fence_prepare)


def inspect(root: Path, nonce: str, signed_message: bytes, owner_uid: int = 0) -> str:
    """Even healthy-looking evidence is only UNVERIFIED."""
    reservations = load('single-use-claim-reservation')
    fence = load('cooperative-revocation-fence')
    if reservations.classify_reservation(root / 'claims', nonce, signed_message,
                                         owner_uid) != 'RESERVED_UNTRUSTED':
        return 'UNCERTAIN'
    try:
        state = fence.inspect(root / 'fence')
        if state['inFlight'] is not None or state['leaseState'] == 'uncertain':
            return 'UNCERTAIN'
    except (OSError, ValueError, PermissionError):
        return 'UNCERTAIN'
    # No authenticated terminal receipt exists, even if the marker completed.
    return 'UNCERTAIN'
