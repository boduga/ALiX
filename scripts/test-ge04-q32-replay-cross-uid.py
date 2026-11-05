import json
from pathlib import Path
import subprocess
import sys
import unittest
P=Path(__file__).with_name('ge04-q32-replay-cross-uid.py')
class Tests(unittest.TestCase):
 def test_opt_in_required(self):
  p=subprocess.run([sys.executable,'-B',str(P),'--issuer','nobody','--supervisor','nobody','--coordinator','nobody','--attacker','nobody'],capture_output=True,text=True)
  self.assertEqual(p.returncode,78)
  self.assertEqual(json.loads(p.stdout)['disposition'],'HOLD')
 def test_nonroot_rejected(self):
  if __import__('os').geteuid()==0:self.skipTest('nonroot only')
  p=subprocess.run([sys.executable,'-B',str(P),'--isolated-test','--issuer','nobody','--supervisor','nobody','--coordinator','nobody','--attacker','nobody'],capture_output=True,text=True)
  self.assertEqual(p.returncode,78)
  self.assertFalse(json.loads(p.stdout)['qualified_independent_issuance'])
if __name__=='__main__':unittest.main()
