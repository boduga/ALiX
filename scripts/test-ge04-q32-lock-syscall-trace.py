import json, os, pathlib, shutil, subprocess, unittest
SCRIPT=pathlib.Path(__file__).with_name('ge04-q32-lock-syscall-trace.py')
class Trace(unittest.TestCase):
 def test_scratch_lock_trace(self):
  if os.geteuid()==0 or not shutil.which('strace'):self.skipTest('requires nonroot strace')
  p=subprocess.run(['python3','-B',str(SCRIPT),'--isolated-test'],capture_output=True,text=True,timeout=30)
  self.assertEqual(p.returncode,78,p.stderr)
  d=json.loads(p.stdout)
  self.assertTrue(d.get('all_expected'),d)
  self.assertEqual(d['disposition'],'HOLD')
  self.assertFalse(d['qualified_independent_issuance'])
 def test_opt_in(self):
  p=subprocess.run(['python3','-B',str(SCRIPT)],capture_output=True,text=True,timeout=5)
  self.assertEqual(p.returncode,78)
  self.assertEqual(json.loads(p.stdout)['disposition'],'HOLD')
if __name__=='__main__':unittest.main()
