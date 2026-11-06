import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
P=Path(__file__).with_name('ge04-q32-deny-replay-ledger.py')
spec=importlib.util.spec_from_file_location('deny_replay',P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
B={'issuer':'issuer','attempt':'a','generation':'1','nonce':'n'}
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.db=Path(self.tmp.name)/'scratch.sqlite'
  m.initialize(self.db)
 def tearDown(self):self.tmp.cleanup()
 def check(self,r):
  self.assertFalse(r['authorized'])
  self.assertEqual(r['disposition'],'HOLD')
  self.assertEqual(r['real_effects_performed'],0)
 def test_first_and_replay_both_denied(self):
  for expected in ('FIRST_OBSERVATION_DENIED','REPLAY_DENIED'):
   r=m.observe(self.db,B);self.check(r);self.assertEqual(r['reason'],expected)
 def test_restart_persists_observation(self):
  self.check(m.observe(self.db,B))
  p=subprocess.run([sys.executable,'-B','-c',f"import importlib.util; s=importlib.util.spec_from_file_location('m',{str(P)!r}); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.observe({str(self.db)!r},{B!r})['reason'])"],capture_output=True,text=True)
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertEqual(p.stdout.strip(),'REPLAY_DENIED')
 def test_concurrent_single_first_observation(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
   results=list(pool.map(lambda _:m.observe(self.db,B),range(24)))
  self.assertEqual(sum(r['reason']=='FIRST_OBSERVATION_DENIED' for r in results),1)
  self.assertEqual(sum(r['reason']=='REPLAY_DENIED' for r in results),23)
  for r in results:self.check(r)
 def test_distinct_attempt_or_generation(self):
  for key in ('attempt','generation','nonce','issuer'):
   r=m.observe(self.db,{**B,key:'other'});self.check(r)
   self.assertEqual(r['reason'],'FIRST_OBSERVATION_DENIED')
 def test_invalid_and_missing_db_denied(self):
  self.assertEqual(m.observe(self.db,{'issuer':'a'})['reason'],'INVALID_BINDING')
  self.assertEqual(m.observe(Path(self.tmp.name)/'missing.sqlite',B)['reason'],'LEDGER_ERROR_DENIED')
 def test_cli_never_authorizes(self):
  for args in ([],['--isolated-test']):
   p=subprocess.run([sys.executable,'-B',str(P),*args],capture_output=True,text=True)
   self.assertEqual(p.returncode,78)
   self.check(json.loads(p.stdout))
if __name__=='__main__':unittest.main()
