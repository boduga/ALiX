"""Real TLS + durable SQLite endorsement custody, test-only HTTP fixture."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import shutil
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location(
    "ge04_durable_endorsements", ROOT/"scripts/ge04-r2s-durable-endorsement-custody.py")
durable=importlib.util.module_from_spec(spec)
spec.loader.exec_module(durable)

helper_spec=importlib.util.spec_from_file_location(
    "ge04_two_role_base",Path(__file__).with_name("test_ge04_r2s_mtls_dual_role_binding.py"))
helper=importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helper)


class DurableTwoRoleTests(helper.TwoRoleBindingTests):
    """Inherited 11 real TLS cases plus restart, races and adversarial storage."""

    def setUp(self):
        super().setUp()
        self.db_path=str(self.root/"endorsements.sqlite")
        self.binder=self._open(provision=True)

    def _open(self, *, epoch="epoch-a", provision=False):
        cust=durable.DurableEndorsementCustody(
            self.db_path,self.binder._identities,
            anchor_id="anchor-a",epoch=epoch)
        cust.initialize(provision=provision)
        return cust

    def test_publisher_observation_survives_restart(self):
        self.assertTrue(self.call("publisher","publisher")["publisherObserved"])
        self.binder=self._open()
        self.assertEqual(self.binder.inspect(self.body["requestId"])["observationState"],"pending")
        self.assertTrue(self.call("committer","committer")["rolesBound"])
        self.assertFalse(self.binder.inspect(self.body["requestId"])["authorizationGranted"])

    def test_spent_id_remains_spent_across_restart(self):
        self.call("publisher","publisher")
        self.assertTrue(self.call("committer","committer")["rolesBound"])
        self.binder=self._open()
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))
        self.assertFalse(self.call("publisher","publisher").get("publisherObserved",False))
        self.assertEqual(self.binder.inspect(self.body["requestId"])["observationState"],"spent")

    def test_changed_request_spends_token_even_after_restart(self):
        self.call("publisher","publisher")
        altered={**self.body,"proposalSha256":"d"*64}
        self.assertFalse(self.call("committer","committer",altered).get("rolesBound",False))
        self.binder=self._open()
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))
        self.assertFalse(self.binder.inspect(self.body["requestId"])["rolesBound"])

    def test_concurrent_committers_exactly_one_consistent_record(self):
        self.call("publisher","publisher")
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses=list(pool.map(lambda _:self.call("committer","committer"),range(16)))
        self.assertEqual(sum(r.get("rolesBound",False) for r in responses),1)
        self.assertTrue(all(r["status"]=="blocked" and not r["authorizationGranted"]
                            for r in responses))
        self.assertTrue(self.binder.inspect(self.body["requestId"])["rolesBound"])

    def test_lost_ack_commits_consumption_but_remains_blocked(self):
        # Isolated simulation: make the first server-side method return
        # ambiguous response after committing the spent observation.
        original=self.binder.committer_observation
        self.binder.committer_observation=lambda conn,raw:original(
            conn,raw,simulate_lost_ack=True)
        self.call("publisher","publisher")
        response=self.call("committer","committer")
        self.assertEqual(response["status"],"blocked")
        self.assertFalse(response.get("rolesBound",False))
        self.binder=self._open()
        self.assertTrue(self.binder.inspect(self.body["requestId"])["rolesBound"])
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))

    def test_different_configured_epoch_fails_closed(self):
        self.call("publisher","publisher")
        changed=durable.DurableEndorsementCustody(
            self.db_path,self.binder._identities,anchor_id="anchor-a",epoch="epoch-b")
        with self.assertRaises(ValueError):
            changed.initialize()
        self.assertEqual(changed.inspect(self.body["requestId"])["status"],"blocked")

    def test_missing_or_corrupt_db_fails_closed_not_reinitialize(self):
        self.call("publisher","publisher")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE identity SET anchor_id='attacker' WHERE singleton=1")
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))
        self.assertEqual(self.binder.inspect(self.body["requestId"])["status"],"blocked")

    def test_snapshot_rollback_destroys_local_custody_proof(self):
        # Important negative qualification: without independent floor, local
        # SQLite can be restored to earlier state and replay IDs are forgotten.
        backup=self.root/"snapshot.sqlite"
        shutil.copy2(self.db_path,backup)
        self.call("publisher","publisher")
        self.assertTrue(self.call("committer","committer")["rolesBound"])
        shutil.copy2(backup,self.db_path)
        self.binder=self._open()
        self.assertFalse(self.binder.inspect(self.body["requestId"]).get("rolesBound",False))
        self.assertTrue(self.call("publisher","publisher")["publisherObserved"])
        self.assertFalse(self.binder.inspect(self.body["requestId"])["authorizationGranted"])

    def test_missing_database_never_auto_reprovisions(self):
        self.assertTrue(self.binder.inspect("not-recorded-request-001")["securityHoldActive"])
        candidate=durable.DurableEndorsementCustody(
            str(self.root/"absent.sqlite"),self.binder._identities,
            anchor_id="anchor-a",epoch="epoch-a")
        with self.assertRaises(FileNotFoundError):
            candidate.initialize()
        self.assertFalse((self.root/"absent.sqlite").exists())

    def test_reprovisioning_existing_db_denied(self):
        with self.assertRaises(FileExistsError):
            self.binder.initialize(provision=True)

    def test_symlink_db_denied(self):
        link=self.root/"symlink.sqlite"
        link.symlink_to(self.db_path)
        candidate=durable.DurableEndorsementCustody(
            str(link),self.binder._identities,anchor_id="anchor-a",epoch="epoch-a")
        with self.assertRaises(ValueError):
            candidate.initialize()

    def test_mismatch_same_token_does_not_consume_for_wrong_role(self):
        self.call("publisher","publisher")
        self.assertFalse(self.call("publisher","committer").get("rolesBound",False))
        self.assertTrue(self.call("committer","committer")["rolesBound"])


if __name__=="__main__":
    unittest.main()
