import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
P = Path(__file__).with_name('ge04-q32-inert-target-reconcile.py')
spec = importlib.util.spec_from_file_location('inert_target', P)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'target.sqlite'
        self.db = m.connect(self.path)
    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()
    def test_lost_ack_reconciled_after_reopen(self):
        self.assertEqual(m.submit(self.db, 'k', 'd')[0], 'FIRST_COMMIT')
        self.db.close(); self.db = m.connect(self.path)
        self.assertEqual(m.lookup(self.db, 'k', 'd'), 'CONFIRMED_SYNTHETIC')
        self.assertEqual(self.db.execute('SELECT count(*) FROM target_receipts').fetchone()[0], 1)
    def test_duplicate_key_same_digest_single_result(self):
        self.assertEqual(m.submit(self.db, 'k', 'd')[0], 'FIRST_COMMIT')
        self.assertEqual(m.submit(self.db, 'k', 'd')[0], 'REPLAY_SAME')
        self.assertEqual(self.db.execute('SELECT count(*) FROM target_receipts').fetchone()[0], 1)
    def test_duplicate_key_different_digest_rejected(self):
        m.submit(self.db, 'k', 'd')
        self.assertEqual(m.submit(self.db, 'k', 'other')[0], 'CONFLICT')
        self.assertEqual(m.lookup(self.db, 'k', 'other'), 'CONFLICT')
    def test_missing_receipt_not_proof_of_non_effect(self):
        self.assertEqual(m.lookup(self.db, 'absent', 'd'), 'NOT_OBSERVED')
        self.assertEqual(self.db.execute('SELECT count(*) FROM target_receipts').fetchone()[0], 0)
    def test_reconcile_read_only(self):
        for _ in range(3):
            self.assertEqual(m.lookup(self.db, 'k', 'd'), 'NOT_OBSERVED')
        self.assertEqual(self.db.execute('SELECT count(*) FROM target_receipts').fetchone()[0], 0)
    def test_blank_inputs_denied(self):
        self.assertEqual(m.submit(self.db, '', 'd')[0], 'DENIED')
        self.assertEqual(m.submit(self.db, 'k', '')[0], 'DENIED')
    def test_cli_hold(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--isolated-test', '--database', str(self.path)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['real_effects_performed'], 0)
    def test_missing_opt_in(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--database', str(self.path)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
if __name__ == '__main__':
    unittest.main()
