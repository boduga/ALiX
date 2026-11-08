"""GE-04 R3 TPM2A crash state machine + independent simulated hardware floor."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import shutil
import sqlite3
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[2]/"scripts"

def load(path, alias):
    import sys
    spec=importlib.util.spec_from_file_location(alias,ROOT/path)
    obj=importlib.util.module_from_spec(spec)
    sys.modules[alias]=obj
    spec.loader.exec_module(obj)
    return obj

sim=load("ge04-r3-tpm-checkpoint-simulator.py","ge04_tpm_sim_test")
protocol=load("ge04-r2s-anchor-protocol.py","ge04_tpm_protocol_test")


class TPMCheckpointModelTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="ge04-tpm-model-")
        self.addCleanup(self.temp.cleanup)
        self.db=str(Path(self.temp.name)/"journal.sqlite")
        self.nv=sim.SimulatedNVExtend(nv_name="qualification-only-nv-name")
        self.engine=self._engine()
        self.engine.provision_fixture()

    def _engine(self, *, epoch="e1", nv=None):
        return sim.QualificationTPMCheckpoint(self.db,nv or self.nv,
                                               anchor_id="alix-a",epoch=epoch)

    def head(self, revision=1, predecessor=None):
        if predecessor is None:
            predecessor=protocol.GENESIS
        return protocol.make_head(anchor_id="alix-a",epoch="e1",revision=revision,
                                  policy="a"*64,checkpoint="b"*64,
                                  signer_key_sha256="c"*64,
                                  predecessor=predecessor)

    def test_prepare_extend_reconcile_and_restart_never_allow(self):
        h=self.head()
        self.assertTrue(self.engine.prepare(h,"request-tpm-0000001")["intentPrepared"])
        self.assertTrue(self.engine.inspect()["pending"])
        self.assertTrue(self.engine.execute_simulated_extend(
            "request-tpm-0000001")["extended"])
        self.engine=self._engine()
        self.assertTrue(self.engine.reconcile()["reconciled"])
        result=self.engine.inspect()
        self.assertEqual(result["revision"],1)
        self.assertFalse(result["pending"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["rollbackResistant"])

    def test_lost_ack_persists_nv_and_reconciles_after_restart(self):
        h=self.head()
        self.engine.prepare(h,"request-tpm-0000001")
        reply=self.engine.execute_simulated_extend("request-tpm-0000001",
                                                    lose_ack=True)
        self.assertFalse(reply["authorizationGranted"])
        self.engine=self._engine()
        self.assertTrue(self.engine.inspect()["pending"])
        self.assertTrue(self.engine.reconcile()["reconciled"])
        self.assertFalse(self.engine.execute_simulated_extend(
            "request-tpm-0000001").get("extended",False))

    def test_crash_after_prepare_never_auto_extends(self):
        self.engine.prepare(self.head(),"request-tpm-0000001")
        self.engine=self._engine()
        before=self.nv.read()
        response=self.engine.reconcile()
        self.assertFalse(response.get("reconciled",False))
        self.assertEqual(self.nv.read(),before)
        self.assertTrue(self.engine.inspect()["pending"])
        self.assertFalse(self.engine.prepare(self.head(),"request-tpm-0000002")
                         .get("intentPrepared",False))

    def test_database_snapshot_rollback_is_detected_against_simulated_nv(self):
        backup=Path(self.temp.name)/"old.sqlite"
        shutil.copy2(self.db,backup)
        self.engine.prepare(self.head(),"request-tpm-0000001")
        self.engine.execute_simulated_extend("request-tpm-0000001")
        self.engine.reconcile()
        shutil.copy2(backup,self.db)
        self.engine=self._engine()
        self.assertFalse(self.engine.inspect()["journalConsistent"])
        self.assertFalse(self.engine.prepare(self.head(),"request-tpm-0000002")
                         .get("intentPrepared",False))

    def test_changed_nv_name_fails_closed(self):
        other=sim.SimulatedNVExtend(nv_name="wrong-nv")
        e=self._engine(nv=other)
        self.assertFalse(e.inspect()["journalConsistent"])

    def test_simulated_nv_state_reset_detected(self):
        self.engine.prepare(self.head(),"request-tpm-0000001")
        self.engine.execute_simulated_extend("request-tpm-0000001")
        self.engine.reconcile()
        e=self._engine(nv=sim.SimulatedNVExtend(nv_name=self.nv.name))
        self.assertFalse(e.inspect()["journalConsistent"])

    def test_tamper_with_stored_head_detected(self):
        self.engine.prepare(self.head(),"request-tpm-0000001")
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE records SET head_sha256=? WHERE revision=1",
                         ("d"*64,))
        self.assertFalse(self.engine.inspect()["journalConsistent"])
        self.assertFalse(self.engine.reconcile().get("reconciled",False))

    def test_missing_db_never_autocreates_and_symlink_denied(self):
        path=Path(self.db)
        path.unlink()
        self.assertFalse(self.engine.inspect()["journalConsistent"])
        self.assertFalse(path.exists())
        path.symlink_to(Path(self.temp.name)/"elsewhere")
        self.assertFalse(self.engine.inspect()["journalConsistent"])

    def test_reprovision_attempt_denied(self):
        with self.assertRaises(ValueError):
            self.engine.provision_fixture()

    def test_old_commit_replayed_is_denied(self):
        self.engine.prepare(self.head(),"request-tpm-0000001")
        self.engine.execute_simulated_extend("request-tpm-0000001")
        self.engine.reconcile()
        self.assertFalse(self.engine.prepare(self.head(),"request-tpm-0000001")
                         .get("intentPrepared",False))
        self.assertFalse(self.engine.execute_simulated_extend("request-tpm-0000001")
                         .get("extended",False))

    def test_next_head_chaining_and_fork_denied(self):
        first=self.head()
        self.engine.prepare(first,"request-tpm-0000001")
        self.engine.execute_simulated_extend("request-tpm-0000001")
        self.engine.reconcile()
        fork=self.head(revision=2,predecessor="d"*64)
        self.assertFalse(self.engine.prepare(fork,"request-tpm-0000002")
                         .get("intentPrepared",False))
        second=self.head(revision=2,predecessor=protocol.digest(first))
        self.assertTrue(self.engine.prepare(second,"request-tpm-0000002")
                        ["intentPrepared"])
        self.assertTrue(self.engine.execute_simulated_extend(
            "request-tpm-0000002")["extended"])
        self.assertTrue(self.engine.reconcile()["reconciled"])
        self.assertEqual(self.engine.inspect()["revision"],2)

    def test_concurrent_same_head_only_one_prep(self):
        def work(i):
            return self._engine().prepare(self.head(),f"request-tpm-{i:07d}")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(work,range(24)))
        self.assertEqual(sum(r.get("intentPrepared",False) for r in results),1)
        self.assertEqual(self.nv.read(),sim.ZERO)

    def test_no_authority_across_every_public_method(self):
        results=[self.engine.inspect(),self.engine.reconcile(),
                 self.engine.prepare(self.head(),"request-tpm-0000001"),
                 self.engine.execute_simulated_extend("request-tpm-0000001")]
        for result in results:
            self.assertEqual(result["status"],"blocked")
            self.assertTrue(result["securityHoldActive"])
            self.assertFalse(result["authorizationGranted"])


if __name__=="__main__":
    unittest.main()
