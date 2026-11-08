"""GE-04-R2S SQLite durability/CAS adversarial qualification only."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import multiprocessing
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]/"scripts"

def load(name,alias):
    spec=importlib.util.spec_from_file_location(alias,ROOT/name)
    import sys
    m=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=m
    spec.loader.exec_module(m)
    return m

protocol=load("ge04-r2s-anchor-protocol.py","ge04_protocol_test_durable")
storemod=load("ge04-r2s-durable-anchor-store.py","ge04_store_test")

def process_commit(path,head,q):
    store=storemod.DurableQualificationAnchor(path,anchor_id="anchor-a",
        epoch="epoch-a",signer_key_sha256="c"*64)
    q.put(store.commit(head=head,expected_revision=0,
        expected_head_sha256=protocol.GENESIS,request_id="parallel-proc-0001",
        asserted_role="committer",publisher="publisher-A",
        publisher_allowlist=frozenset({"publisher-A"}))["status"])


class DurableStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix="ge04-sqlite-anchor-")
        self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/"anchor.sqlite")
        self.store=self.new_store()
        self.store.initialize()
        self.one=protocol.make_head(anchor_id="anchor-a",epoch="epoch-a",revision=1,
            policy="a"*64,checkpoint="b"*64,signer_key_sha256="c"*64,
            predecessor=protocol.GENESIS)

    def new_store(self):
        return storemod.DurableQualificationAnchor(self.path,
            anchor_id="anchor-a",epoch="epoch-a",signer_key_sha256="c"*64)

    def commit(self,head=None,request="commit-request-0001",revision=0,
               predecessor=None,role="committer",publisher="publisher-A",
               **more):
        return self.store.commit(head=head or self.one,
            expected_revision=revision,
            expected_head_sha256=predecessor or protocol.GENESIS,
            request_id=request,asserted_role=role,
            publisher=publisher,publisher_allowlist=frozenset({"publisher-A"}),**more)

    def test_initialization_and_empty_head_still_hold(self):
        s=self.store.read_head()
        self.assertEqual(s["revision"],0)
        self.assertFalse(s["authorizationGranted"])
        self.assertFalse(s["rollbackResistant"])
        self.assertTrue(s["securityHoldActive"])

    def test_commit_reopen_and_restart(self):
        response=self.commit()
        self.assertEqual(response["status"],"recorded-qualification-only")
        reopened=self.new_store()
        reopened.initialize()
        observed=reopened.read_head()
        self.assertEqual(observed["revision"],1)
        self.assertEqual(observed["headSha256"],protocol.digest(self.one))
        self.assertFalse(observed["authorizationGranted"])

    def test_second_valid_commit(self):
        self.commit()
        second=protocol.make_head(anchor_id="anchor-a",epoch="epoch-a",revision=2,
            policy="f"*64,checkpoint="e"*64,signer_key_sha256="c"*64,
            predecessor=protocol.digest(self.one))
        result=self.commit(second,request="commit-request-0002",
            revision=1,predecessor=protocol.digest(self.one))
        self.assertEqual(result["status"],"recorded-qualification-only")
        self.assertEqual(self.new_store().read_head()["revision"],2)

    def test_duplicate_idempotency_after_restart(self):
        self.commit()
        self.store=self.new_store()
        result=self.commit()
        self.assertEqual(result["status"],"previously-recorded-qualification-only")
        self.assertEqual(result["revision"],1)
        self.assertFalse(result["authorizationGranted"])

    def test_same_request_different_payload_denied(self):
        self.commit()
        forged={**self.one,"policySha256":"f"*64}
        self.assertEqual(self.commit(forged)["status"],"blocked")
        self.assertEqual(self.store.read_head()["headSha256"],protocol.digest(self.one))

    def test_stale_retry_with_new_request_denied(self):
        self.commit()
        self.assertEqual(self.commit(request="commit-request-0002")["status"],"blocked")
        self.assertEqual(self.store.read_head()["revision"],1)

    def test_fake_roles_and_publisher_denied(self):
        for role,publisher in (
            ("verifier","publisher-A"),("publisher","publisher-A"),
            ("security-operator","publisher-A"),("committer","publisher-B")):
            self.assertEqual(self.commit(role=role,publisher=publisher)["status"],"blocked")
        self.assertEqual(self.store.read_head()["revision"],0)

    def test_ambiguous_commit_reconcile_after_restart(self):
        outcome=self.commit(simulate_lost_ack=True)
        self.assertEqual(outcome["status"],"blocked")
        self.assertEqual(self.new_store().read_head()["revision"],1)
        self.store=self.new_store()
        self.assertEqual(self.commit()["status"],"previously-recorded-qualification-only")
        self.assertEqual(self.commit(request="commit-request-0002")["status"],"blocked")

    def test_64_way_multithread_stale_cas_only_one_winner(self):
        def run(i):
            return self.commit(request=f"parallel-thread-{i:04d}")["status"]
        with ThreadPoolExecutor(max_workers=16) as pool:
            statuses=list(pool.map(run,range(64)))
        self.assertEqual(statuses.count("recorded-qualification-only"),1)
        self.assertEqual(self.store.read_head()["revision"],1)

    def test_multiprocess_same_request_idempotent(self):
        ctx=multiprocessing.get_context("fork")
        q=ctx.Queue()
        workers=[ctx.Process(target=process_commit,args=(self.path,self.one,q))
                 for _ in range(12)]
        for worker in workers:worker.start()
        for worker in workers:
            worker.join(timeout=15)
            self.assertEqual(worker.exitcode,0)
        statuses=[q.get(timeout=3) for _ in workers]
        self.assertEqual(statuses.count("recorded-qualification-only"),1)
        self.assertEqual(statuses.count("previously-recorded-qualification-only"),11)
        self.assertEqual(self.store.read_head()["revision"],1)

    def test_epoch_and_key_identity_cannot_reinitialize(self):
        alternate=storemod.DurableQualificationAnchor(
            self.path,anchor_id="anchor-a",epoch="epoch-b",signer_key_sha256="c"*64)
        with self.assertRaises(ValueError):
            alternate.initialize()
        self.assertEqual(alternate.read_head()["status"],"blocked")
        self.assertEqual(self.store.read_head()["revision"],0)

    def test_bad_head_and_noncanonical_revisions_denied(self):
        for changed in ({"revision":True},{"revision":2},
                        {"previousHeadSha256":"f"*64},{"signerKeySha256":"d"*64},
                        {"epoch":"epoch-b"},{"extra":"x"}):
            with self.subTest(changed=changed):
                result=self.commit({**self.one,**changed})
                self.assertEqual(result["status"],"blocked")
        self.assertEqual(self.store.read_head()["revision"],0)

    def test_invalid_request_ids_and_bool_expected_revision(self):
        for request in ("tiny","contains spaces","a"*129):
            self.assertEqual(self.commit(request=request)["status"],"blocked")
        self.assertEqual(self.commit(revision=True)["status"],"blocked")

    def test_sqlite_schema_corruption_denied(self):
        self.commit()
        with sqlite3.connect(self.path) as conn:
            conn.execute("UPDATE heads SET head_sha256=? WHERE revision=1",("f"*64,))
        self.assertEqual(self.store.read_head()["status"],"blocked")
        self.assertEqual(self.commit(request="commit-request-0002")["status"],"blocked")

    def test_snapshot_rollback_is_not_prevented_by_sqlite(self):
        # This is a *negative proof*: SQLite durability != rollback resistance.
        snapshot=Path(self.tmp.name)/"snapshot.sqlite"
        shutil.copy2(self.path,snapshot)
        self.commit()
        self.assertEqual(self.store.read_head()["revision"],1)
        shutil.copy2(snapshot,self.path)
        reverted=self.new_store().read_head()
        self.assertEqual(reverted["revision"],0)
        self.assertFalse(reverted["rollbackResistant"])
        self.assertTrue(reverted["securityHoldActive"])

    def test_symlink_database_rejected(self):
        alias=Path(self.tmp.name)/"link.sqlite"
        alias.symlink_to(self.path)
        suspicious=storemod.DurableQualificationAnchor(
            str(alias),anchor_id="anchor-a",epoch="epoch-a",signer_key_sha256="c"*64)
        self.assertEqual(suspicious.read_head()["status"],"blocked")
        self.assertEqual(suspicious.commit(head=self.one,expected_revision=0,
            expected_head_sha256=protocol.GENESIS,request_id="symlink-attempt-0001",
            asserted_role="committer",publisher="publisher-A",
            publisher_allowlist=frozenset({"publisher-A"}))["status"],"blocked")


if __name__=="__main__":
    unittest.main()
