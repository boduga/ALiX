import importlib.util
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
P=Path(__file__).with_name('ge04-q32-inert-custody.py')
spec=importlib.util.spec_from_file_location('inert_custody',P)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'authority.sqlite'
        self.db=m.connect(self.path)
        self.assertTrue(m.issue(self.db,'a','k','d',1,'supervisor',1))
    def tearDown(self):
        self.db.close();self.tmp.cleanup()
    def test_matching_binding(self):
        self.assertEqual(m.verify(self.db,'a','k','d',1,'supervisor',1),'MATCH_SYNTHETIC_ONLY')
    def test_forged_key(self):
        self.assertEqual(m.verify(self.db,'a','fake','d',1,'supervisor',1),'HOLD_AUTHORITY_MISMATCH')
    def test_forged_digest(self):
        self.assertEqual(m.verify(self.db,'a','k','fake',1,'supervisor',1),'HOLD_AUTHORITY_MISMATCH')
    def test_stale_revision(self):
        self.assertEqual(m.verify(self.db,'a','k','d',2,'supervisor',1),'HOLD_AUTHORITY_MISMATCH')
    def test_wrong_audience(self):
        self.assertEqual(m.verify(self.db,'a','k','d',1,'coordinator',1),'HOLD_AUTHORITY_MISMATCH')
    def test_wrong_generation(self):
        self.assertEqual(m.verify(self.db,'a','k','d',1,'supervisor',2),'HOLD_AUTHORITY_MISMATCH')
    def test_missing_attempt(self):
        self.assertEqual(m.verify(self.db,'b','k','d',1,'supervisor',1),'HOLD_NO_AUTHORITY_BINDING')
    def test_immutable_and_unique_key(self):
        self.assertFalse(m.issue(self.db,'a','fake','d',1,'supervisor',1))
        self.assertFalse(m.issue(self.db,'b','k','d',1,'supervisor',1))
    def test_reopen_preserves_binding(self):
        self.db.close();self.db=m.connect(self.path)
        self.assertEqual(m.verify(self.db,'a','k','d',1,'supervisor',1),'MATCH_SYNTHETIC_ONLY')
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        root=Path(self.tmp.name)
        ip=root.parent / 'none'
        spec2=importlib.util.spec_from_file_location('integrated_custody_test',P.with_name('ge04-q32-inert-integrated-recovery.py'))
        self.integration=importlib.util.module_from_spec(spec2)
        sys.modules[spec2.name]=self.integration
        spec2.loader.exec_module(self.integration)
        self.j=self.integration.journal.connect(root/'journal.sqlite')
        self.t=self.integration.target.connect(root/'target.sqlite')
        self.a=m.connect(root/'authority.sqlite')
        self.integration.journal.begin(self.j,'a',1)
        self.integration.bind_synthetic(self.j,'a','k','d',1)
        self.integration.journal.mark_possible(self.j,'a',1)
        self.integration.journal.recover(self.j,'a')
        m.issue(self.a,'a','k','d',1,'supervisor',1)
    def tearDown(self):
        self.j.close();self.t.close();self.a.close();self.tmp.cleanup()
    def test_matching_authority_and_receipt(self):
        self.integration.target.submit(self.t,'k','d')
        self.assertEqual(self.integration.reconcile_with_authority(self.j,self.t,self.a,'a','k','d'),'RECONCILED_SYNTHETIC_ONLY')
    def test_untrusted_journal_binding_replaced(self):
        self.j.execute("UPDATE synthetic_bindings SET idempotency_key='evil',request_digest='evil' WHERE attempt='a'")
        self.integration.target.submit(self.t,'evil','evil')
        self.assertEqual(self.integration.reconcile_with_authority(self.j,self.t,self.a,'a','evil','evil'),'HOLD_AUTHORITY_MISMATCH')
    def test_untrusted_journal_attempt_swapped(self):
        self.integration.journal.begin(self.j,'b',1)
        self.integration.bind_synthetic(self.j,'b','kb','db',1)
        self.integration.journal.mark_possible(self.j,'b',1)
        self.integration.journal.recover(self.j,'b')
        self.integration.target.submit(self.t,'kb','db')
        self.assertEqual(self.integration.reconcile_with_authority(self.j,self.t,self.a,'b','kb','db'),'HOLD_NO_AUTHORITY_BINDING')
    def test_forged_revision_audience_generation(self):
        for rev,aud,gen in ((2,'supervisor',1),(1,'coordinator',1),(1,'supervisor',2)):
            self.assertEqual(self.integration.reconcile_with_authority(self.j,self.t,self.a,'a','k','d',rev,aud,gen),'HOLD_AUTHORITY_MISMATCH')
    def test_authority_match_does_not_authorize_missing_receipt(self):
        self.assertEqual(self.integration.reconcile_with_authority(self.j,self.t,self.a,'a','k','d'),'HOLD_UNRESOLVED')

if __name__=='__main__':unittest.main()
