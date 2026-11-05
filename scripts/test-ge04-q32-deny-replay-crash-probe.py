import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
P=Path(__file__).with_name('ge04-q32-deny-replay-crash-probe.py')
class Tests(unittest.TestCase):
 def test_missing_opt_in_holds(self):
  p=subprocess.run([sys.executable,'-B',str(P)],capture_output=True,text=True)
  self.assertEqual(p.returncode,78)
  self.assertFalse(json.loads(p.stdout)['authorized'])
 @unittest.skipIf(sys.platform!='linux' or os.geteuid()==0,'nonroot Linux only')
 def test_kill_points_recover_deny_only(self):
  p=subprocess.run([sys.executable,'-B',str(P),'--isolated-test'],capture_output=True,text=True,timeout=20)
  self.assertEqual(p.returncode,78,p.stderr)
  data=json.loads(p.stdout)
  self.assertTrue(data['all_denied_and_recovered'],data)
  self.assertEqual(len(data['cases']),3)
if __name__=='__main__':unittest.main()
