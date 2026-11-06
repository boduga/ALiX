#!/usr/bin/env python3
"""Q3.2 issuer boundary contract diagnostic. Never validates a credential.

Test-supplied identity facts are untrusted and do not establish OS custody.
Every outcome remains HOLD; no authorization artifact or signing key exists.
"""
from __future__ import annotations
import json
from dataclasses import dataclass

DENIED = 'DENIED GE04_SECURITY_HOLD'

@dataclass(frozen=True)
class Boundary:
    issuer_uid: int
    supervisor_uid: int
    coordinator_uid: int
    attacker_uid: int
    issuer_store_owner_uid: int
    policy_store_owner_uid: int
    claims_store_owner_uid: int
    issuer_store_mode: int
    policy_store_mode: int
    claims_store_mode: int


def inspect_boundary(facts: Boundary) -> dict:
    reasons = []
    uids = (facts.issuer_uid, facts.supervisor_uid, facts.coordinator_uid,
            facts.attacker_uid)
    if any(type(uid) is not int or uid <= 0 for uid in uids) or len(set(uids)) != 4:
        reasons.append('identities_not_four_distinct_nonroot_uids')
    if facts.issuer_store_owner_uid != facts.issuer_uid:
        reasons.append('issuer_store_owner_mismatch')
    if facts.policy_store_owner_uid != facts.issuer_uid:
        reasons.append('policy_store_owner_mismatch')
    if facts.claims_store_owner_uid != facts.supervisor_uid:
        reasons.append('claims_store_owner_mismatch')
    for name in ('issuer', 'policy', 'claims'):
        mode = getattr(facts, name + '_store_mode')
        if type(mode) is not int or mode != 0o600:
            reasons.append(name + '_store_mode_not_private')
    return {'gate': 'GE04_Q32_ISSUER_BOUNDARY', 'disposition': 'HOLD',
            'qualified_independent_issuance': False,
            'synthetic_separation_checks_passed': not reasons,
            'reasons': reasons, 'response': DENIED}


if __name__ == '__main__':
    print(json.dumps({'gate': 'GE04_Q32_ISSUER_BOUNDARY', 'disposition': 'HOLD',
                      'qualified_independent_issuance': False, 'response': DENIED}))
    raise SystemExit(78)
