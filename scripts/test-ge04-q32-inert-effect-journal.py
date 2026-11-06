import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
P=Path(__file__).with_name('ge04-q32-inert-effect-journal.py')
spec=importlib.util.spec_from_file_location('inert_journal',P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'journal.sqlite'
        self.db=m.connect(self.path)
    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()
    def test_intent_durable_and_single_use(self):
        self.assertTrue(m.begin(self.db,'a',1))
        self.assertFalse(m.begin(self.db,'a',1))
        self.db.close()
        self.db=m.connect(self.path)
        self.assertEqual(m.phase(self.db,'a'),'INTENT')
    def test_crash_before_effect_aborts(self):
        m.begin(self.db,'a',1)
        self.db.close(); self.db=m.connect(self.path)
        self.assertEqual(m.recover(self.db,'a'),'ABORTED')
        self.assertFalse(m.mark_possible(self.db,'a',1))
        self.assertFalse(m.begin(self.db,'a',1))
    def test_crash_after_possible_is_ambiguous(self):
        m.begin(self.db,'a',1)
        self.assertTrue(m.mark_possible(self.db,'a',1))
        self.db.close(); self.db=m.connect(self.path)
        self.assertEqual(m.recover(self.db,'a'),'UNKNOWN_RECOVERY')
        self.assertFalse(m.mark_possible(self.db,'a',1))
        self.assertFalse(m.begin(self.db,'a',1))
    def test_stale_revision_cannot_start(self):
        m.begin(self.db,'a',1)
        self.assertFalse(m.mark_possible(self.db,'a',2))
    def test_missing_does_not_recover(self):
        self.assertIsNone(m.recover(self.db,'missing'))
    def test_cli_hold(self):
        p=subprocess.run([sys.executable,'-B',str(P),'--isolated-test','--database',str(self.path)],capture_output=True,text=True)
        self.assertEqual(p.returncode,78)
        self.assertEqual(json.loads(p.stdout)['real_effects_performed'],0)
if __name__=='__main__': unittest.main()
