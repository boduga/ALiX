#!/usr/bin/env python3
"""GE-04 final-boundary ordering contract: model tests, not authority."""
import importlib.util
from pathlib import Path
from dataclasses import replace

spec = importlib.util.spec_from_file_location(
    'ge04_boundary_model', Path(__file__).with_name('final-boundary-protocol-model.py'))
model = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = model
spec.loader.exec_module(model)

R = model.sample_request

def new():
    return model.InertBoundaryModel()

def prepared(m, r=None):
    r = r or R()
    assert m.prepare(r, 999) == 'INERT_PREPARED_UNVERIFIED'
    return r

# Stale coordinator GO never authorizes a kernel operation after revocation.
one = new()
assert one.revoke(8) == 'REVOKED_UNVERIFIED'
assert one.prepare(R(), 999) == 'DENIED'
assert one.receipts == []

# The final check is at the serialized boundary; expiry at lock entry denies.
two = new()
assert two.prepare(R(), 1000) == 'DENIED'
assert two.prepare(R(), 1001) == 'DENIED'
assert two.receipts == []

# A wrong approval, lease, policy, operation digest, worker or scope denies.
for changed in (
    {'approval': 'wrong'}, {'lease': 'wrong'}, {'policy_revision': 8},
    {'operation_digest': 'bad'}, {'worker': 'wrong'}, {'scope': '../outside'},
):
    m = new()
    assert m.prepare(replace(R(), **changed), 100) == 'DENIED', changed
    assert m.consumed == set() and m.receipts == []

# A prepared attempt excludes explicit revocation from publishing in-between.
three = new()
r = prepared(three)
assert three.revoke(8) == 'WAIT_FOR_TERMINAL_OR_UNKNOWN'
assert three.revision == 7 and not three.revoked
assert three.observe_inert_effect(r, 'wrong', r.scope) == 'DENIED'
assert three.observe_inert_effect(r, r.operation_digest, '../outside') == 'DENIED'
assert three.receipts == []
assert three.observe_inert_effect(r, r.operation_digest, r.scope) == 'INERT_EFFECT_OBSERVED_UNVERIFIED'
assert three.settle(r) == 'INERT_TERMINAL_UNVERIFIED'
assert three.revoke(8) == 'REVOKED_UNVERIFIED'
assert three.prepare(replace(R(), attempt='attempt-2'), 100) == 'DENIED'
assert three.event_log.index('PREPARE_DURABLE_BEFORE_EFFECT') < three.event_log.index('INERT_BOUNDARY_OBSERVED') < three.event_log.index('INERT_RECEIPT_RECORDED') < three.event_log.index('REVOCATION_LINEARIZED')

# Crash at prepare / after effect must be UNKNOWN even if no receipt exists.
for after_effect in (False, True):
    m = new()
    r = prepared(m)
    if after_effect:
        assert m.observe_inert_effect(r, r.operation_digest, r.scope).endswith('UNVERIFIED')
    assert m.crash() == 'UNCERTAIN'
    assert m.recover(r) == 'UNCERTAIN_NO_REPLAY'
    assert m.prepare(r, 100) == 'DENIED'
    assert m.settle(r) == 'UNCERTAIN'
    assert m.revoke(8) == 'REVOKED_UNVERIFIED'
    assert m.receipts == []

# A second invocation cannot reuse a spent approval even with a new attempt ID.
four = new()
r = prepared(four)
assert four.observe_inert_effect(r, r.operation_digest, r.scope).endswith('UNVERIFIED')
assert four.settle(r) == 'INERT_TERMINAL_UNVERIFIED'
# This model intentionally exposes that a consumed *attempt ID* alone is
# insufficient to enforce single-use approval. This is a release blocker.
different = replace(r, attempt='attempt-2')
assert four.prepare(different, 100) == 'DENIED', 'approval was reused'
print('GE04 final-boundary ordering model PASS: final check, revocation exclusion, expiry, pinned scope, crash quarantine, approval single-use')
