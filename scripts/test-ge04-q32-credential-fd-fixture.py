import json, os, pathlib, subprocess, unittest
SCRIPT=pathlib.Path(__file__).with_name('ge04-q32-credential-fd-fixture.cjs')
class CredentialFdFixture(unittest.TestCase):
 def test_synthetic_transfer(self):
  if os.geteuid()==0:self.skipTest('requires nonroot')
  p=subprocess.run(['node',str(SCRIPT),'--isolated-test'],capture_output=True,text=True,timeout=15)
  self.assertEqual(p.returncode,78,p.stderr)
  result=json.loads(p.stdout)
  self.assertTrue(result['all_expected'],result)
  self.assertFalse(result['qualified_independent_issuance'])
  self.assertEqual(result['disposition'],'HOLD')
 def test_opt_in(self):
  p=subprocess.run(['node',str(SCRIPT)],capture_output=True,text=True,timeout=5)
  self.assertEqual(p.returncode,78)
  self.assertEqual(json.loads(p.stdout)['disposition'],'HOLD')
if __name__=='__main__':unittest.main()
