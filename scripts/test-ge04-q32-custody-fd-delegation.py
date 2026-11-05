import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-custody-fd-delegation.py')
class Tests(unittest.TestCase):
    def test_requires_role_arguments(self):
        self.assertNotEqual(subprocess.run([sys.executable, '-B', str(P)], capture_output=True).returncode, 0)
    def test_without_opt_in_holds(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--issuer', 'nobody', '--attacker', 'nobody'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
    def test_duplicate_identity_holds(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--isolated-test', '--issuer', 'nobody', '--attacker', 'nobody'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
if __name__ == '__main__':
    unittest.main()
