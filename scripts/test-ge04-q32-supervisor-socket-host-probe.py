import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-supervisor-socket-host-probe.py')
class Tests(unittest.TestCase):
    def test_no_opt_in_holds(self):
        p = subprocess.run([sys.executable, '-B', str(P)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
    @unittest.skipIf(sys.platform != 'linux' or __import__('os').geteuid() == 0, 'nonroot Linux only')
    def test_four_cases_all_deny(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--isolated-test'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78, p.stderr)
        output = json.loads(p.stdout)
        self.assertTrue(output['all_denied'], output)
        self.assertEqual(len(output['cases']), 4)
if __name__ == '__main__': unittest.main()
