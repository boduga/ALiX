import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-custody-cross-uid.py')
class Tests(unittest.TestCase):
    def test_missing_roles_rejected(self):
        p = subprocess.run([sys.executable, '-B', str(P)], capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
    def test_without_opt_in_never_runs(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--issuer','nobody',
            '--supervisor','nobody','--coordinator','nobody','--attacker','nobody'],
            capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
    def test_nonroot_or_duplicate_accounts_fail_closed(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--isolated-test',
            '--issuer','nobody','--supervisor','nobody',
            '--coordinator','nobody','--attacker','nobody'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
if __name__ == '__main__':
    unittest.main()
