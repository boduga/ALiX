"""GE-04-R2I issuer custody qualification-only regression tests."""
import importlib.util
import multiprocessing
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/ge04-r2i-issuer-custody.py"
spec = importlib.util.spec_from_file_location("ge04_r2i", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2i-", dir=str(pathlib.Path.home()))
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name) / "custody"
        self.directory.mkdir(mode=0o700)
        self.lock = self.directory / "issuer.lock"
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)

    def claim(self, owner="issuer-one", **kwargs):
        return mod.claim_issuer_custody(str(self.directory), owner,
                                       required_uid=os.geteuid(), **kwargs)

    def test_exclusive_claim_is_sticky_across_close(self):
        with self.claim() as custody:
            self.assertEqual(custody.owner_id, "issuer-one")
            self.assertTrue((self.directory / "issuer.claim").exists())
            with self.assertRaisesRegex(mod.CustodyDenied, "lock already held"):
                self.claim("issuer-two")
        with self.assertRaisesRegex(mod.CustodyDenied, "manual recovery required"):
            self.claim("issuer-two")

    def test_subprocess_cannot_take_over(self):
        with self.claim():
            code = ("""import importlib.util,os,sys
spec=importlib.util.spec_from_file_location("m",sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
try:
 m.claim_issuer_custody(sys.argv[2],"other",required_uid=os.geteuid())
except m.CustodyDenied:
 sys.exit(23)
sys.exit(0)
""")
            child = subprocess.run([sys.executable, "-c", code, str(SOURCE), str(self.directory)],
                                   capture_output=True, text=True, timeout=5)
            self.assertEqual(child.returncode, 23, child.stderr)

    def test_crashed_claim_is_not_taken_over(self):
        code = ("""import importlib.util,os,sys
spec=importlib.util.spec_from_file_location("m",sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.claim_issuer_custody(sys.argv[2],"crashed",required_uid=os.geteuid())
os._exit(19)
""")
        child = subprocess.run([sys.executable, "-c", code, str(SOURCE), str(self.directory)],
                               capture_output=True, text=True, timeout=5)
        self.assertEqual(child.returncode, 19, child.stderr)
        with self.assertRaisesRegex(mod.CustodyDenied, "manual recovery required"):
            self.claim("replacement")

    def test_symlink_directory_denied(self):
        link = self.directory.parent / "alias"
        link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(mod.CustodyDenied):
            mod.claim_issuer_custody(str(link), "issuer",
                                    required_uid=os.geteuid())

    def test_symlink_lock_denied(self):
        self.lock.unlink()
        self.lock.symlink_to("/etc/passwd")
        with self.assertRaises(OSError):
            self.claim()

    def test_world_writable_parent_denied(self):
        self.directory.parent.chmod(0o777)
        with self.assertRaises(mod.CustodyDenied):
            self.claim()
        self.directory.parent.chmod(0o700)

    def test_wrong_lock_permissions_denied(self):
        self.lock.chmod(0o666)
        with self.assertRaises(mod.CustodyDenied):
            self.claim()

    def test_missing_lock_denied_without_claim(self):
        self.lock.unlink()
        with self.assertRaises(FileNotFoundError):
            self.claim()
        self.assertFalse((self.directory / "issuer.claim").exists())

    def test_wrong_owner_uid_denied(self):
        with self.assertRaisesRegex(mod.CustodyDenied, "effective uid"):
            mod.claim_issuer_custody(str(self.directory), "owner",
                                    required_uid=os.geteuid()+1)

    def test_bad_owner_and_traversal_denied(self):
        for owner in ("", "../attacker", "spaces not allowed"):
            with self.subTest(owner=owner), self.assertRaises(mod.CustodyDenied):
                self.claim(owner)
        with self.assertRaises(mod.CustodyDenied):
            mod.claim_issuer_custody(str(self.directory / ".."), "owner",
                                    required_uid=os.geteuid())


if __name__ == "__main__":
    unittest.main()
