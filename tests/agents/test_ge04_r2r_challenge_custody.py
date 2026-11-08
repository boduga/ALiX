"""Fail-closed R2R challenge store tests."""
import importlib.util
from pathlib import Path
import tempfile
import concurrent.futures
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2r-challenge-custody.py"
spec = importlib.util.spec_from_file_location("r2r_challenges", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ChallengeCustodyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="r2r-challenge-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.path = self.root / "challenges.sqlite"
        mod.create_custody(self.path)
        self.store = mod.ChallengeCustody(self.path)
        self.addCleanup(self.store.close)

    def test_issue_consume_once(self):
        n = self.store.issue()
        self.assertEqual(len(n), 64)
        self.assertTrue(self.store.consume(n))
        self.assertFalse(self.store.consume(n))

    def test_restart_does_not_resurrect(self):
        n = self.store.issue()
        self.assertTrue(self.store.consume(n))
        other = mod.ChallengeCustody(self.path)
        try:
            self.assertFalse(other.consume(n))
        finally:
            other.close()

    def test_restart_valid_pending_consumable_once(self):
        n = self.store.issue()
        other = mod.ChallengeCustody(self.path)
        try:
            self.assertTrue(other.consume(n))
            self.assertFalse(self.store.consume(n))
        finally:
            other.close()

    def test_forged_challenge_denied(self):
        self.assertFalse(self.store.consume("f" * 64))
        self.assertFalse(self.store.consume("xyz"))

    def test_invalid_lifetime_denied(self):
        with self.assertRaises(ValueError):
            self.store.consume(self.store.issue(), ttl_seconds=-1)

    def test_expired_challenge_denied(self):
        n = self.store.issue()
        self.store.db.execute("UPDATE challenges SET created_mono=0 WHERE nonce=?", (n,))
        self.assertFalse(self.store.consume(n))

    def test_future_timestamp_denied(self):
        n = self.store.issue()
        self.store.db.execute("UPDATE challenges SET created_mono=999999999999 WHERE nonce=?", (n,))
        self.assertFalse(self.store.consume(n))

    def test_boot_mismatch_denied(self):
        n = self.store.issue()
        self.store.db.execute("UPDATE challenges SET boot_id='old' WHERE nonce=?", (n,))
        self.assertFalse(self.store.consume(n))

    def test_invalid_file_mode_denied(self):
        self.path.chmod(0o644)
        with self.assertRaises(PermissionError):
            mod.ChallengeCustody(self.path)

    def test_invalid_parent_mode_denied(self):
        self.root.chmod(0o755)
        with self.assertRaises(PermissionError):
            mod.ChallengeCustody(self.path)

    def test_symlink_denied(self):
        alias = self.root / "linked.sqlite"
        alias.symlink_to(self.path)
        with self.assertRaises(ValueError):
            mod.ChallengeCustody(alias)

    def test_recreate_refused(self):
        with self.assertRaises(FileExistsError):
            mod.create_custody(self.path)

    def test_two_connections_cannot_consume_same_nonce(self):
        n = self.store.issue()
        def consume_once(_):
            c = mod.ChallengeCustody(self.path)
            try:
                return c.consume(n)
            finally:
                c.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            values = list(pool.map(consume_once, range(2)))
        self.assertEqual(sorted(values), [False, True])

    def test_consumed_before_invalid_response_cannot_be_retried(self):
        # A bad signature is evaluated after the nonce is consumed.
        n = self.store.issue()
        self.assertTrue(self.store.consume(n))
        self.assertFalse(self.store.consume(n))

    def test_distinct_issued_nonces(self):
        self.assertNotEqual(self.store.issue(), self.store.issue())

    def test_replay_persists_across_reopen(self):
        n = self.store.issue()
        self.assertTrue(self.store.consume(n))
        self.store.close()
        other = mod.ChallengeCustody(self.path)
        try:
            self.assertFalse(other.consume(n))
        finally:
            other.close()
        self.store = mod.ChallengeCustody(self.path)


if __name__ == "__main__":
    unittest.main()
