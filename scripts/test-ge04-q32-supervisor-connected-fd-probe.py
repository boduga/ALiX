import json
from pathlib import Path
import subprocess
import sys
import unittest
P=Path(__file__).with_name('ge04-q32-supervisor-connected-fd-probe.py')
class Tests(unittest.TestCase):
 def test_missing_opt_in(self):
  p=subprocess.run([sys.executable,'-B',str(P),'--supervisor','nobody','--attacker','nobody'],capture_output=True,text=True)
  self.assertEqual(p.returncode,78)
  self.assertEqual(json.loads(p.stdout)['disposition'],'HOLD')
 def test_nonroot_opt_in(self):
  if __import__('os').geteuid()==0:self.skipTest('nonroot only')
  p=subprocess.run([sys.executable,'-B',str(P),'--isolated-test','--supervisor','nobody','--attacker','nobody'],capture_output=True,text=True)
  self.assertEqual(p.returncode,78)
  self.assertFalse(json.loads(p.stdout)['qualified_independent_issuance'])
if __name__=='__main__':unittest.main()
