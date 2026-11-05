#!/usr/bin/env python3
"""GE-04 journal negative tests. Fixture-only, no trusted rollback claims."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'ge04_journal', Path(__file__).with_name('supervisor-lifecycle-journal.py'))
journal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journal)


class JournalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ge04-journal-test-')
        self.fd = os.open(self.temp.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.digest = journal.fingerprint(dict(attemptId='fixed', operation='create'))

    def tearDown(self):
        os.close(self.fd)
        self.temp.cleanup()

    def write(self, index, raw):
        path = Path(self.temp.name) / ('ge04-lifecycle-' + str(index) + '.json')
        path.write_bytes(raw)
        path.chmod(0o600)

    def read(self, index):
        return (Path(self.temp.name) / ('ge04-lifecycle-' + str(index) + '.json')).read_bytes()

    def test_complete_chain_never_claims_success(self):
        for name in journal.STAGES:
            journal.append(self.fd, self.digest, name)
        self.assertEqual('CHAIN_COMPLETE_UNVERIFIED', journal.classify(self.fd, self.digest))
        records, _ = journal.read_chain(self.fd, self.digest)
        self.assertEqual([1, 2, 3, 4], [r['sequence'] for r in records])
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, 'a' * 64))

    def test_partial_chain_is_uncertain(self):
        journal.append(self.fd, self.digest, 'PREPARED')
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))

    def test_out_of_order_and_duplicate_refused(self):
        with self.assertRaises(PermissionError):
            journal.append(self.fd, self.digest, 'SIGNED')
        journal.append(self.fd, self.digest, 'PREPARED')
        with self.assertRaises(PermissionError):
            journal.append(self.fd, self.digest, 'PREPARED')

    def test_gap_and_partial_rollback_fail_closed(self):
        for name in journal.STAGES:
            journal.append(self.fd, self.digest, name)
        (Path(self.temp.name) / 'ge04-lifecycle-2.json').unlink()
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))

    def test_wrong_binding_and_tampered_record_fail_closed(self):
        for name in journal.STAGES:
            journal.append(self.fd, self.digest, name)
        raw = self.read(2)
        self.write(2, raw.replace(b'OBSERVED', b'PREPARED'))
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))

    def test_duplicate_keys_and_wrong_type_fail_closed(self):
        journal.append(self.fd, self.digest, 'PREPARED')
        original = self.read(1)
        self.write(1, original.replace(b'"version":1', b'"version":1,"version":1'))
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))
        self.write(1, original.replace(b'"sequence":1', b'"sequence":true'))
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))

    def test_symlink_and_permissions_fail_closed(self):
        journal.append(self.fd, self.digest, 'PREPARED')
        path = Path(self.temp.name) / 'ge04-lifecycle-1.json'
        path.chmod(0o666)
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))
        path.chmod(0o600)
        path.unlink()
        path.symlink_to(Path(self.temp.name) / 'elsewhere')
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))

    def test_replay_altered_request_fails(self):
        journal.append(self.fd, self.digest, 'PREPARED')
        with self.assertRaises(PermissionError):
            journal.append(self.fd, journal.fingerprint({'other': 'request'}), 'OBSERVED')

    def test_full_tree_rollback_is_outside_threat_proof(self):
        # A forged self-consistent chain with original request cannot establish
        # global freshness without an externally protected monotonic floor.
        for name in journal.STAGES:
            journal.append(self.fd, self.digest, name)
        for index in (4, 3):
            (Path(self.temp.name) / ('ge04-lifecycle-' + str(index) + '.json')).unlink()
        self.assertEqual('UNCERTAIN_NO_REPLAY', journal.classify(self.fd, self.digest))


if __name__ == '__main__':
    unittest.main()
