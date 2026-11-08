"""GE-04-R2Q isolated witness tests; no machine policy mutations."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest import mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2q-witness-service.py"
spec = importlib.util.spec_from_file_location("r2q_witness", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
r2p_spec = importlib.util.spec_from_file_location(
    "r2q_r2p", SOURCE.with_name("ge04-r2p-external-witness-receipt.py"))
r2p = importlib.util.module_from_spec(r2p_spec)
r2p_spec.loader.exec_module(r2p)


class WitnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="r2q-")
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.db, self.key, self.pub = [str(base / n) for n in ("head.sqlite", "signing.key", "pub.hex")]
        self.policy, self.checkpoint = "a" * 64, "b" * 64
        self.pub_hex = None
        with mock.patch.object(mod.os, "geteuid", return_value=0):
            self.pub_hex = mod.initialize(self.db, self.key, self.pub)
            mod.append_head(self.db, 1, self.policy, self.checkpoint)

    def advance(self, revision, policy=None, checkpoint=None):
        with mock.patch.object(mod.os, "geteuid", return_value=0):
            return mod.append_head(self.db, revision, policy or self.policy,
                                   checkpoint or self.checkpoint)

    def test_first_head_and_signature_receipt(self):
        handler = mod.handler_factory(self.db, mod.load_signer(self.key))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        data = json.dumps({"nonce": "c"*64, "bootId": "qual-boot"}).encode()
        response = json.loads(urlopen(Request(
            "http://127.0.0.1:%d/challenge" % server.server_port,
            data=data, headers={"Content-Type": "application/json"}), timeout=3).read())
        verdict = r2p.verify_witness_receipt(
            response, trusted_public_key=bytes.fromhex(self.pub_hex),
            challenge_nonce="c"*64, witness_id=mod.WITNESS_ID,
            checkpoint_digest=self.checkpoint, policy_digest=self.policy,
            revision=1, minimum_revision=1, boot_id="qual-boot")
        self.assertTrue(verdict["signatureVerified"])
        self.assertTrue(verdict["headMatched"])
        self.assertEqual(verdict["status"], "blocked")
        self.assertFalse(verdict["rollbackResistant"])

    def test_advancement_strictly_monotonic(self):
        self.assertEqual(self.advance(2), 2)
        self.assertEqual(mod.read_head(self.db)[0], 2)

    def test_duplicate_and_stale_rejected(self):
        for revision in (0, 1, -1):
            with self.subTest(revision=revision):
                with self.assertRaises(ValueError):
                    self.advance(revision)
        self.assertEqual(mod.read_head(self.db)[0], 1)

    def test_revision_gap_rejected(self):
        with self.assertRaises(ValueError):
            self.advance(3)
        self.assertEqual(mod.read_head(self.db)[0], 1)

    def test_conflicting_same_revision_rejected(self):
        with self.assertRaises(ValueError):
            self.advance(1, policy="f"*64)

    def test_bad_digest_rejected(self):
        with self.assertRaises(ValueError):
            self.advance(2, policy="not-a-hash")

    def test_nonroot_cannot_mutate(self):
        with self.assertRaises(PermissionError):
            mod.append_head(self.db, 2, self.policy, self.checkpoint)
        with self.assertRaises(PermissionError):
            mod.initialize("missing", "missing", "missing")

    def test_reinitialize_refused(self):
        with mock.patch.object(mod.os, "geteuid", return_value=0):
            with self.assertRaises(FileExistsError):
                mod.initialize(self.db, self.key, self.pub)

    def test_restart_keeps_revision(self):
        self.advance(2)
        self.assertEqual(mod.read_head(self.db)[0], 2)
        with mod._db(self.db) as conn:
            self.assertEqual(conn.execute("SELECT revision FROM head").fetchone()[0], 2)

    def test_secret_key_permissions(self):
        self.assertEqual(os.stat(self.key).st_mode & 0o777, 0o600)
        os.chmod(self.key, 0o644)
        with self.assertRaises(PermissionError):
            mod.load_signer(self.key)

    def test_no_http_mutation_route(self):
        handler = mod.handler_factory(self.db, mod.load_signer(self.key))
        self.assertFalse(hasattr(handler, "do_PUT"))
        self.assertFalse(hasattr(handler, "do_DELETE"))
        self.assertEqual(mod.BIND, "127.0.0.1")

    def test_snapshot_rollback_still_unqualified(self):
        # Restoring a full VM snapshot can rewind both DB and signing key.
        # Unit tests do NOT constitute rollback resistance.
        self.assertEqual(mod.read_head(self.db)[0], 1)
        self.assertEqual(mod.WITNESS_ID, "alix-ge04-r2q-qualifier")


if __name__ == "__main__":
    unittest.main()
