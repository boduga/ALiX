import json
import os
from pathlib import Path
import subprocess
import unittest
P=Path(__file__).with_name('ge04-q32-real-lock-fd-probe.mjs')
class Tests(unittest.TestCase):
 def test_actual_lock_scratch_path(self):
  if os.geteuid()==0:self.skipTest('nonroot only')
  p=subprocess.run(['node',str(P),'--isolated-test'],capture_output=True,text=True,timeout=15)
  self.assertEqual(p.returncode,78,p.stderr)
  data=json.loads(p.stdout)
  self.assertTrue(data.get('all_expected'),data)
  self.assertEqual(data['real_effects_performed'],0)
  self.assertFalse(data['qualified_independent_issuance'])
 def test_opt_in(self):
  p=subprocess.run(['node',str(P)],capture_output=True,text=True,timeout=15)
  self.assertEqual(p.returncode,78)
  self.assertEqual(json.loads(p.stdout)['disposition'],'HOLD')
if __name__=='__main__':unittest.main()
