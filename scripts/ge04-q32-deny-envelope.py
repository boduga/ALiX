#!/usr/bin/env python3
"""Pure synthetic request-envelope checks; never returns authorization."""
import json

FIELDS = ('protocol_version', 'issuer', 'issuer_release', 'supervisor_release',
          'run', 'worker', 'attempt', 'generation', 'nonce', 'audience',
          'operation', 'capability', 'target_digest', 'arguments_digest',
          'approval_id', 'approval_revision', 'policy_revision', 'expires_at')
BASE = {'gate': 'GE04_Q32_ENVELOPE', 'disposition': 'HOLD',
        'authorized': False, 'qualified_independent_issuance': False,
        'real_effects_performed': 0}


def inspect(payload, expected, seen=None):
    """Fail closed; expected is a synthetic comparison fixture, not trusted authority."""
    if not isinstance(payload, dict) or not isinstance(expected, dict):
        reason = 'INVALID_ENVELOPE'
    elif set(payload) != set(FIELDS) or any(type(payload.get(k)) is not str or not payload[k].strip() for k in FIELDS):
        reason = 'INVALID_BINDING'
    elif set(expected) != set(FIELDS) or any(type(expected.get(k)) is not str for k in FIELDS):
        reason = 'INVALID_EXPECTATION'
    elif payload['protocol_version'] != 'synthetic-v1' or payload['audience'] != 'supervisor':
        reason = 'WRONG_PROTOCOL_OR_AUDIENCE'
    elif any(payload[k] != expected[k] for k in FIELDS):
        reason = 'BINDING_MISMATCH'
    elif seen is not None and (payload['issuer'], payload['attempt'], payload['generation'], payload['nonce']) in seen:
        reason = 'REPLAY_OBSERVED'
    else:
        reason = 'DENIED_SECURITY_HOLD'
    return {**BASE, 'reason': reason}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    args = parser.parse_args()
    print(json.dumps({**BASE, 'reason': 'DENIED_SECURITY_HOLD' if args.isolated_test else 'ISOLATED_TEST_REQUIRED'}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
