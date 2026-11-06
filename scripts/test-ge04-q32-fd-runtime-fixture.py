"""Nonprivileged synthetic Node FD boundary regression."""
import json
from pathlib import Path
import subprocess
import unittest
SCRIPT=Path(__file__).with_name('ge04-q32-fd-runtime-fixture.cjs')
class Tests(unittest.TestCase):
 def test_inherited_regular_file_contract(self):
  p=subprocess.run(['node',str(SCRIPT)],capture_output=True,text=True,timeout=15)
  self.assertEqual(p.returncode,0,p.stderr)
  data=json.loads(p.stdout)
  self.assertTrue(data['all_expected'],data)
  self.assertEqual(data['observed_fd_numbers']['passed'],[9])
  self.assertEqual(data['observed_fd_numbers']['normal'],[])
  self.assertEqual(data['observed_fd_numbers']['ignored'],[])
  self.assertEqual(data['disposition'],'HOLD')
  self.assertFalse(data['qualified_independent_issuance'])
  self.assertEqual(data['real_effects_performed'],0)
if __name__=='__main__':unittest.main()
