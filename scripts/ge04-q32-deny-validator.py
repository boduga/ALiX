#!/usr/bin/env python3
"""GE-04 Q3.2 pure negative binding probe; NEVER issues effect authority.

Expected binding is supplied by the *test*, not authenticated or loaded from
protected custody. Equality is diagnostic only. Every request returns DENIED.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

FIELDS = ('run_id', 'worker_id', 'attempt_id', 'generation', 'capability',
          'target', 'arguments_digest', 'policy_revision', 'approval_id',
          'principal', 'release_digest', 'nonce')
DENIED = 'DENIED GE04_SECURITY_HOLD'


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key] = value
    return result


def parse_request(raw: bytes) -> dict:
    if not raw or len(raw) > 4096:
        raise ValueError('invalid frame size')
    obj = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_pairs)
    if not isinstance(obj, dict) or set(obj) != set(FIELDS):
        raise ValueError('invalid field set')
    if any(type(obj[k]) is not str or not obj[k] or len(obj[k]) > 256 for k in FIELDS):
        raise ValueError('invalid field type or length')
    return obj


@dataclass(frozen=True)
class Diagnostic:
    matched: bool
    reason: str
    response: str = DENIED
    authorized: bool = False


def inspect(raw: bytes, expected: dict, *, claimed_nonces: set[str] | None = None,
            policy_current: bool = True, approval_current: bool = True) -> Diagnostic:
    """Pure comparison, not authorization; claimed_nonces is test-only state."""
    try:
        request = parse_request(raw)
    except (UnicodeError, ValueError, TypeError, json.JSONDecodeError):
        return Diagnostic(False, 'malformed')
    if set(expected) != set(FIELDS) or any(request[k] != expected[k] for k in FIELDS):
        return Diagnostic(False, 'binding_mismatch')
    if not policy_current or not approval_current:
        return Diagnostic(False, 'stale_policy_or_approval')
    if claimed_nonces is not None and request['nonce'] in claimed_nonces:
        return Diagnostic(False, 'replay')
    # No claim is written: this probe deliberately cannot grant or consume.
    return Diagnostic(True, 'diagnostic_match_only')


if __name__ == '__main__':
    print(DENIED)
    raise SystemExit(78)
