import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-issuer-fd-delegation.py')
spec = importlib.util.spec_from_file_location('fd_probe', P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def test_denial_constant(self):
        self.assertEqual(m.DENIAL, b'DENIED GE04_SECURITY_HOLD\n')
    def test_no_opt_in(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--issuer', 'root', '--attacker', 'root'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
    def test_duplicate_uid_rejected_if_root(self):
        import os
        if os.geteuid() != 0:
            self.skipTest('privileged only')
        p = subprocess.run([sys.executable, '-B', str(P), '--isolated-test', '--issuer', 'root', '--attacker', 'root'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
if __name__ == '__main__':
    unittest.main()
