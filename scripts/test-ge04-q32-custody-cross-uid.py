import json
import ast
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
    def test_issuer_not_in_negative_fixture_dispatch(self):
        # Regression for microcloud3: issuer previously replaced the shared fixture.
        source = P.read_text()
        tree = ast.parse(source)
        run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run')
        dispatches = [n for n in ast.walk(run) if isinstance(n, ast.DictComp)
                      and any(isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
                              and c.func.id == 'child_attempt' for c in ast.walk(n))]
        self.assertEqual(len(dispatches), 1)
        self.assertIn("('supervisor', 'coordinator', 'attacker')", ast.unparse(dispatches[0]))
        self.assertIn("results['issuer'] = child_attempt(users['issuer'], issuer_dir, issuer_fixture)", source)
        self.assertIn("issuer_positive_observed", source)

if __name__ == '__main__':
    unittest.main()
