"""GE-04 closed cgroup fixture: sweep-admission and root-identity regressions.

Two source-review findings are pinned here. Neither test runs a privileged
fixture, writes a cgroup, creates a unit, calls systemd or executes as root.

1. ``sweep_empty`` must never adopt a ``worker-*`` directory discovered by a
   name scan. Removal requires a canonical ``intent.tmp`` whose name, device
   and inode match the observed entry; otherwise the state is quarantine.
2. The privileged entry gate and every custody predicate require root:root.
   Root uid alone is not the protected context.

The executable assertions use ``tests/fixtures/ge04-sweep-admission-probe.c``,
which includes the real worker source with ``main`` renamed and evaluates the
same static predicates over fabricated inputs. The source-shape assertions are
a separate guard: they fail if the destructive path stops consulting those
predicates. Neither form is a privileged qualification.
"""
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "native/ge04/cgroup-worker-qualification.c"
SIBLING = ROOT / "native/ge04/cgroup-runtime-view-qualification.c"
PROBE = ROOT / "tests/fixtures/ge04-sweep-admission-probe.c"

MODE = "0700"
WORKER = "worker-" + "a" * 16
OTHER = "worker-" + "b" * 16


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native compiler required")
class SweepAdmissionSourceTests(unittest.TestCase):
    """Source shape: the removal path consults intent, not a directory scan."""

    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text()

    def sweep_body(self):
        begin = self.text.index("static int sweep_empty(struct context *c) {")
        end = self.text.index("int main(int argc,char **argv) {", begin)
        return self.text[begin:end]

    def test_sweep_requires_matching_unpublished_intent(self):
        body = self.sweep_body()
        destructive = body.index("unlinkat(c->parent,e->d_name,AT_REMOVEDIR)")
        guard = body.index("if(!sweep_candidate_allowed(")
        self.assertLess(guard, destructive,
                        "sweep must validate intent before rmdir")
        # The admission predicate itself binds name, device and inode.
        predicate = self.text[self.text.index("static int sweep_candidate_allowed("):
                              self.text.index("static int sweep_empty(struct context *c) {")]
        self.assertIn("if(!has_temp||!pending->leaf_dev||!pending->leaf_ino||!pending->parent_ino)return 0;", predicate)
        self.assertIn("!strcmp(name,pending->name)", predicate)
        self.assertIn("observed->st_dev==pending->leaf_dev", predicate)
        self.assertIn("observed->st_ino==pending->leaf_ino", predicate)

    def test_sweep_never_derives_identity_from_the_entry_it_removes(self):
        body = self.sweep_body()
        # The previous defect overwrote the trusted record with fstatat() of the
        # directory being removed, making the "recorded" identity the observed
        # one. That shape must not return.
        self.assertNotIn("c->record=approved;", body)
        self.assertNotIn("c->record.leaf_dev=st.st_dev", body)
        self.assertNotIn("c->record.leaf_ino=st.st_ino", body)
        self.assertNotIn("c->record=pending;strcpy(c->record.name,e->d_name)", body)

    def test_cleanup_without_owned_leaf_refuses(self):
        start = self.text.index("static int cleanup(struct context *c,int notify) {")
        end = self.text.index("static int no_worker_directories(", start)
        cleanup = self.text[start:end]
        self.assertIn("if(!c->owned_leaf)return 0;", cleanup)
        self.assertNotIn("if(!c->owned_leaf)return 1;", cleanup)

    def test_sweep_refusal_is_fail_closed_through_completion(self):
        body = self.sweep_body()
        self.assertRegex(body, r'if\(fstatat\(c->work,"intent\.v1",&st,AT_SYMLINK_NOFOLLOW\)==0\|\|errno!=ENOENT\)return 0;')
        self.assertRegex(body, r'if\(!sweep_candidate_allowed\(has_temp,&pending,&st,e->d_name\)\)\{ok=0;break;\}')
        self.assertRegex(body, r'if\(!ok\)return 0;')
        self.assertLess(body.index('if(!sweep_candidate_allowed('),
                        body.index('unlinkat(c->parent,e->d_name,AT_REMOVEDIR)'))


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native compiler required")
class RootIdentitySourceTests(unittest.TestCase):
    """Source shape: root:root is required everywhere custody is decided."""

    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text()
        cls.sibling = SIBLING.read_text()

    @staticmethod
    def body(text, start, end):
        return text[text.index(start):text.index(end, text.index(start))]

    def test_entry_gate_requires_all_four_root_identities(self):
        main_body = self.text[self.text.index("int main(int argc,char **argv) {"):]
        self.assertIn("if(!root_identity())return 77;", main_body)
        # The weak uid-only gate must not return. A caller cannot weaken the
        # gate by dropping the gid half of the predicate.
        self.assertNotIn("if(getuid()!=0||geteuid()!=0)return 77;", main_body)
        identity = self.body(self.text, "static int root_identity_of(",
                             "static int root_directory_stat(")
        self.assertIn("return uid==0&&euid==0&&gid==0&&egid==0;", identity)
        self.assertIn("root_identity_of(getuid(),geteuid(),getgid(),getegid())",
                      self.body(self.text, "static int root_identity(void) {",
                                "static int root_directory_stat("))

    def test_every_custody_predicate_requires_root_group(self):
        for name, terminator in (
                ("static int root_directory_stat(", "static int root_directory(int fd) {"),
                ("static int regular_root_stat(", "static int regular_root(int fd,"),
                ("static int control_stat(", "static int control(int leaf,"),
                ("static int control_custody(", "static int bindings(struct context *c) {"),
                ("static int bindings(struct context *c) {", "static int empty(struct context *c) {")):
            with self.subTest(predicate=name):
                self.assertIn("root_owned(", self.body(self.text, name, terminator))
        # Both the leaf custody and the worker's /dev/null check are covered.
        self.assertGreaterEqual(self.text.count('root_owned('), 7)

    def test_no_custody_predicate_accepts_uid_only(self):
        # Every direct st_uid comparison outside root_owned is suspect, even
        # when a decoy root_owned call is present in the same expression.
        self.assertEqual(len(re.findall(r'\bst_uid\s*(?:==|!=)', self.text)), 1)
        self.assertEqual(len(re.findall(r'\bst_uid\s*(?:\|\||&&|\|)', self.text)), 0)
        self.assertEqual(self.text.count('&07777)'), 3)
        self.assertNotIn('&0777)', self.text)

    def test_sibling_fixture_agrees_on_root_group(self):
        self.assertIn("if(getuid()||geteuid()||getgid()||getegid())return 77;",
                      self.sibling)
        for marker in ("s.st_uid==0&&s.st_gid==0",
                       "s.st_uid==0&&s.st_gid==0&&",
                       "s.st_uid||s.st_gid||(s.st_mode&0022)"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.sibling)


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native compiler required")
class AdmissionPredicateTests(unittest.TestCase):
    """Execute the real predicates over fabricated inputs; still unprivileged."""

    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="ge04-sweep-admission-")
        cls.binary = str(Path(cls.work.name) / "admission-probe")
        result = subprocess.run(
            ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
             str(PROBE), "-o", cls.binary],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=20)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace"))

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def run_probe(self, *args, prefix):
        completed = subprocess.run([self.binary, *args],
                                   stdin=subprocess.DEVNULL,
                                   capture_output=True, timeout=5, check=False)
        self.assertEqual(completed.returncode, 0,
                         completed.stderr.decode(errors="replace"))
        text = completed.stdout.decode("ascii").strip()
        self.assertTrue(text.startswith(prefix + " "), text)
        return text.split(" ", 1)[1] == "1"

    def sweep(self, has_temp, observed_dev, observed_ino, pending_dev,
              pending_ino, observed=WORKER, pending=WORKER, parent_ino=1):
        return self.run_probe("sweep", str(has_temp), str(observed_dev),
                              str(observed_ino), str(pending_dev),
                              str(pending_ino), observed, pending, str(parent_ino),
                              prefix="SWEEP")

    def test_unauthorized_sweep_without_intent_refuses(self):
        # No intent.tmp at all: name scan is never removal authority.
        self.assertFalse(self.sweep(0, 100, 200, 100, 200))

    def test_matching_intent_still_permits_legitimate_recovery(self):
        self.assertTrue(self.sweep(1, 100, 200, 100, 200))

    def test_missing_intent_identity_refuses(self):
        self.assertFalse(self.sweep(1, 100, 200, 0, 200))
        self.assertFalse(self.sweep(1, 100, 200, 100, 0))
        self.assertFalse(self.sweep(1, 100, 200, 100, 200, parent_ino=0))
        self.assertFalse(self.sweep(1, 0, 200, 0, 200))

    def test_mismatched_intent_name_refuses(self):
        self.assertFalse(self.sweep(1, 100, 200, 100, 200, observed=OTHER))

    def test_mismatched_intent_device_or_inode_refuses(self):
        self.assertFalse(self.sweep(1, 100, 201, 100, 200))
        self.assertFalse(self.sweep(1, 101, 200, 100, 200))

    def identity(self, uid, euid, gid, egid):
        return self.run_probe("identity", str(uid), str(euid), str(gid),
                              str(egid), prefix="IDENTITY")

    def test_root_identity_requires_all_four(self):
        self.assertTrue(self.identity(0, 0, 0, 0))

    def test_nonzero_gid_or_egid_refuses_entry(self):
        self.assertFalse(self.identity(0, 0, 1000, 0))
        self.assertFalse(self.identity(0, 0, 0, 1000))
        self.assertFalse(self.identity(0, 0, 1000, 1000))

    def test_nonzero_uid_or_euid_still_refuses_entry(self):
        self.assertFalse(self.identity(1000, 0, 0, 0))
        self.assertFalse(self.identity(0, 1000, 0, 0))

    def test_group_owned_directory_refuses(self):
        self.assertTrue(self.run_probe("directory", "0", "0", MODE,
                                       prefix="DIRECTORY"))
        self.assertFalse(self.run_probe("directory", "0", "1000", MODE,
                                        prefix="DIRECTORY"))
        self.assertFalse(self.run_probe("directory", "0", "0", "02770",
                                        prefix="DIRECTORY"))
        self.assertFalse(self.run_probe("directory", "1000", "0", MODE,
                                        prefix="DIRECTORY"))

    def test_group_writable_directory_refuses(self):
        self.assertFalse(self.run_probe("directory", "0", "0", "0777",
                                        prefix="DIRECTORY"))

    def test_group_owned_regular_record_refuses(self):
        self.assertTrue(self.run_probe("regular", "0", "0", "0600",
                                       prefix="REGULAR"))
        self.assertFalse(self.run_probe("regular", "0", "1000", "0600",
                                        prefix="REGULAR"))
        self.assertFalse(self.run_probe("regular", "0", "0", "0660",
                                        prefix="REGULAR"))

    def test_setgid_regular_record_refuses(self):
        self.assertFalse(self.run_probe("regular", "0", "0", "02600",
                                        prefix="REGULAR"))

    def test_group_owned_cgroup_control_refuses(self):
        self.assertTrue(self.run_probe("control", "0", "0", "0600", "1",
                                       prefix="CONTROL"))
        self.assertFalse(self.run_probe("control", "0", "1000", "0600", "1",
                                        prefix="CONTROL"))
        self.assertFalse(self.run_probe("control", "0", "0", "0620", "1",
                                        prefix="CONTROL"))
        self.assertFalse(self.run_probe("control", "0", "0", "0600", "0",
                                        prefix="CONTROL"))


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native compiler required")
class UnprivilegedRefusalStillHolds(unittest.TestCase):
    """The ordinary build still refuses before setup for every valid mode."""

    MODES = ("run", "crash-leaf", "crash-temp", "crash-intent", "crash-child",
             "crash-running", "recover", "sweep-empty", "fail-before-clone",
             "fail-attach", "fail-verify", "fail-resume", "fail-publish")

    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="ge04-worker-refusal-")
        cls.binary = str(Path(cls.work.name) / "worker")
        result = subprocess.run(
            ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
             str(SOURCE), "-o", cls.binary],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=20)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace"))

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    @unittest.skipIf(getattr(os, "getuid", lambda: -1)() == 0,
                     "unprivileged refusal is not established by a root run")
    def test_every_mode_refuses_before_setup_without_root(self):
        for mode in self.MODES:
            with self.subTest(mode=mode):
                completed = subprocess.run(
                    [self.binary, mode], stdin=subprocess.DEVNULL,
                    capture_output=True, timeout=5, check=False)
                self.assertEqual(completed.returncode, 77)
                self.assertEqual(completed.stdout, b"")
                self.assertEqual(completed.stderr, b"")

    def test_invalid_mode_still_returns_64(self):
        for args in ([], ["unknown"], ["run", "extra"]):
            with self.subTest(args=args):
                self.assertEqual(subprocess.run(
                    [self.binary, *args], stdin=subprocess.DEVNULL,
                    capture_output=True, timeout=5, check=False).returncode, 64)


if __name__ == "__main__":
    unittest.main()
