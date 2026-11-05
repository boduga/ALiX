#!/usr/bin/env python3
"""Test-only recovery classification; no native effects or privileged assertions."""
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    'ge04_lifecycle', pathlib.Path(__file__).with_name('supervisor-lifecycle-classifier.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

REQ = {'attemptId': 'a1', 'scopeId': 'scope', 'operation': 'create', 'relativePath': 'x'}
DIGEST = mod.canonical_request_digest(REQ)

def encoded(**overrides):
    record = dict(version=1, attemptId='a1', requestDigest=DIGEST,
                  approvalConsumed=True, phase='PREPARED', sequence=3,
                  terminalRecordDigest=None)
    record.update(overrides)
    return json.dumps(record, sort_keys=True).encode()

def recover(raw, **overrides):
    kw = dict(expected_attempt='a1', expected_request_digest=DIGEST, minimum_sequence=3)
    kw.update(overrides)
    return mod.classify_recovery(raw, **kw)

class RecoveryClassifierTest(unittest.TestCase):
    def test_deterministic_fingerprint(self):
        self.assertEqual(DIGEST, mod.canonical_request_digest(dict(reversed(list(REQ.items())))))

    def test_prepared_is_ambiguous(self):
        self.assertEqual(mod.UNCERTAIN, recover(encoded()))

    def test_observation_remains_unverified(self):
        self.assertEqual('EFFECT_OBSERVED_UNVERIFIED',
                         recover(encoded(phase='EFFECT_OBSERVED_UNVERIFIED')))

    def test_settled_still_not_success(self):
        self.assertEqual('SETTLED_RECORD_PRESENT_UNVERIFIED',
                         recover(encoded(phase='SETTLED_UNVERIFIED', terminalRecordDigest='a'*64)))

    def test_no_terminal_without_digest(self):
        self.assertEqual(mod.UNCERTAIN, recover(encoded(phase='SETTLED_UNVERIFIED')))

    def test_wrong_binding_and_rollback(self):
        for change in (dict(expected_attempt='a2'), dict(expected_request_digest='0'*64),
                       dict(minimum_sequence=4)):
            with self.subTest(change=change):
                self.assertEqual(mod.UNCERTAIN, recover(encoded(), **change))

    def test_unconsumed_never_terminal(self):
        self.assertEqual(mod.UNCERTAIN, recover(encoded(approvalConsumed=False,
                         phase='SETTLED_UNVERIFIED', terminalRecordDigest='a'*64)))

    def test_forged_fields_rejected(self):
        for raw in (b'{"version":1,"version":1}', encoded(status='SUCCESS'),
                    encoded(version=True), encoded(sequence=True), encoded(sequence=-1),
                    encoded(requestDigest='A'*64), encoded(phase='VERIFIED_TERMINAL'),
                    encoded(phase='PREPARED', terminalRecordDigest='a'*64),
                    b'', b'{', b'{"x":NaN}', b'\xff', b'x'*4097):
            with self.subTest(raw=raw[:80]):
                self.assertEqual(mod.UNCERTAIN, recover(raw))

    def test_parser_duplicate_keys(self):
        raw = encoded().replace(b'"version": 1', b'"version": 1, "version": 1')
        with self.assertRaises(ValueError):
            mod.parse_record(raw)

if __name__ == '__main__':
    unittest.main()
