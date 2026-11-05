import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
P=Path(__file__).with_name('ge04-q32-inert-integrated-recovery.py')
spec=importlib.util.spec_from_file_location('inert_integrated',P)
m=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=m
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        root=Path(self.tmp.name)
        self.j=m.journal.connect(root/'journal.sqlite')
        self.t=m.target.connect(root/'target.sqlite')
        m.journal.begin(self.j,'a',1)
        m.journal.mark_possible(self.j,'a',1)
        m.journal.recover(self.j,'a')
    def tearDown(self):
        self.j.close(); self.t.close(); self.tmp.cleanup()
    def test_receipt_reconciles_synthetic_only(self):
        m.target.submit(self.t,'k','d')
        self.assertEqual(m.reconcile(self.j,self.t,'a','k','d'),'RECONCILED_SYNTHETIC_ONLY')
        self.assertFalse(m.journal.begin(self.j,'a',1))
    def test_missing_receipt_remains_unresolved(self):
        self.assertEqual(m.reconcile(self.j,self.t,'a','k','d'),'HOLD_UNRESOLVED')
        self.assertEqual(self.t.execute('SELECT count(*) FROM target_receipts').fetchone()[0],0)
    def test_digest_conflict_fails_closed(self):
        m.target.submit(self.t,'k','different')
        self.assertEqual(m.reconcile(self.j,self.t,'a','k','d'),'HOLD_INTEGRITY_CONFLICT')
    def test_missing_attempt_fails_closed(self):
        self.assertEqual(m.reconcile(self.j,self.t,'missing','k','d'),'HOLD_NO_ATTEMPT')
    def test_nonambiguous_phase_fails_closed(self):
        m.journal.begin(self.j,'b',1)
        self.assertEqual(m.reconcile(self.j,self.t,'b','k','d'),'HOLD_NOT_AMBIGUOUS')
    def test_lookup_never_changes_either_store(self):
        before_j=self.j.execute('SELECT * FROM attempts').fetchall()
        before_t=self.t.execute('SELECT * FROM target_receipts').fetchall()
        for _ in range(4): m.reconcile(self.j,self.t,'a','k','d')
        self.assertEqual(before_j,self.j.execute('SELECT * FROM attempts').fetchall())
        self.assertEqual(before_t,self.t.execute('SELECT * FROM target_receipts').fetchall())
    def test_cli_hold(self):
        root=Path(self.tmp.name)
        p=subprocess.run([sys.executable,'-B',str(P),'--isolated-test','--journal',str(root/'cli-j.sqlite'),
                          '--target',str(root/'cli-t.sqlite')],capture_output=True,text=True)
        self.assertEqual(p.returncode,78)
        self.assertEqual(json.loads(p.stdout)['automatic_retries'],0)
        self.assertEqual(json.loads(p.stdout)['outcome'],'HOLD_UNRESOLVED')
    def test_cli_no_opt_in(self):
        p=subprocess.run([sys.executable,'-B',str(P)],capture_output=True,text=True)
        self.assertEqual(p.returncode,78)
if __name__=='__main__': unittest.main()
