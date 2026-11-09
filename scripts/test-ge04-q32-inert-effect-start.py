import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest

spec=importlib.util.spec_from_file_location('inert_effect_start',Path(__file__).with_name('ge04-q32-inert-effect-start.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'state.sqlite'
        self.db=m.initialize(self.path)
    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()
    def test_claim_and_effect_start_are_single_use(self):
        self.assertTrue(m.transact(self.db,'claim','n'))
        self.assertFalse(m.transact(self.db,'claim','n'))
        self.assertTrue(m.transact(self.db,'effect_start','n'))
        self.assertFalse(m.transact(self.db,'effect_start','n'))
    def test_revocation_before_start_denies(self):
        self.assertTrue(m.transact(self.db,'claim','n'))
        self.assertTrue(m.transact(self.db,'revoke'))
        self.assertFalse(m.transact(self.db,'effect_start','n'))
    def test_crash_after_start_cannot_retry(self):
        self.assertTrue(m.transact(self.db,'claim','n'))
        self.assertTrue(m.transact(self.db,'effect_start','n'))
        self.db.close()
        self.db=m.initialize.__globals__['sqlite3'].connect(self.path,isolation_level=None)
        self.assertTrue(m.recover(self.db))
        self.assertEqual(self.db.execute("SELECT phase FROM attempts WHERE nonce='n'").fetchone()[0],'UNKNOWN_RECOVERY')
        self.assertFalse(m.transact(self.db,'effect_start','n'))
        self.assertFalse(m.transact(self.db,'claim','n'))
    def test_concurrent_claim_one_winner(self):
        outcomes=[]
        def claim():
            with m.sqlite3.connect(self.path,isolation_level=None,timeout=5) as db:
                outcomes.append(m.transact(db,'claim','n'))
        threads=[threading.Thread(target=claim) for _ in range(8)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(outcomes.count(True),1)
        self.assertEqual(outcomes.count(False),7)
    def test_revocation_and_effect_start_linearize(self):
        for _ in range(10):
            self.db.execute('DELETE FROM attempts')
            self.db.execute('UPDATE authority SET revision=1,active=1')
            self.assertTrue(m.transact(self.db,'claim','n'))
            results={}
            def work(action):
                with m.sqlite3.connect(self.path,isolation_level=None,timeout=5) as db:
                    results[action]=m.transact(db,action,'n')
            threads=[threading.Thread(target=work,args=(a,)) for a in ('revoke','effect_start')]
            for t in threads:t.start()
            for t in threads:t.join()
            self.assertTrue(results['revoke'])
            phase=self.db.execute("SELECT phase FROM attempts WHERE nonce='n'").fetchone()[0]
            self.assertEqual(results['effect_start'],phase=='EFFECT_POSSIBLE')
            self.assertFalse(m.transact(self.db,'effect_start','n'))
    def test_post_start_revocation_gap_is_explicitly_observable(self):
        # A positive synthetic start can precede a completed revocation.
        # No real syscall is permitted by either observation.
        self.assertTrue(m.transact(self.db,'claim','n'))
        self.assertTrue(m.transact(self.db,'effect_start','n'))
        self.assertTrue(m.transact(self.db,'revoke'))
        self.assertEqual(
            self.db.execute("SELECT phase FROM attempts WHERE nonce='n'").fetchone()[0],
            'EFFECT_POSSIBLE',
        )
        self.assertEqual(
            self.db.execute("SELECT active FROM authority WHERE id=1").fetchone()[0], 0
        )
        self.assertFalse(m.transact(self.db,'effect_start','n'))
        self.assertTrue(m.recover(self.db))
        self.assertEqual(
            self.db.execute("SELECT phase FROM attempts WHERE nonce='n'").fetchone()[0],
            'UNKNOWN_RECOVERY',
        )

    def test_unavailable_or_invalid_fails_closed(self):
        self.assertFalse(m.transact(self.db,'claim',''))
        self.assertFalse(m.transact(self.db,'effect_start','n',revision=2))
        self.db.execute('DELETE FROM authority')
        self.assertFalse(m.transact(self.db,'claim','n'))
        self.assertFalse(m.transact(self.db,'revoke'))

if __name__=='__main__':unittest.main()
