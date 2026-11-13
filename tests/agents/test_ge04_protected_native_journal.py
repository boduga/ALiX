"""GE-04 production-intended C journal source: format and default-deny tests.

Compiles source in an unprivileged temporary directory. Never calls journal
staging as root, creates fixed /var/lib paths, or enables systemd/ACK execution.
"""
import errno
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
NATIVE = REPO / "native/ge04"
sys.path.insert(0, str(NATIVE))
from prebirth_issuance_contract import canonical_prebirth
from test_ge04_prebirth_issuance_contract import prebirth

FLAGS = ("-std=gnu11", "-Wall", "-Wextra", "-Werror", "-Wpedantic",
         "-Wconversion", "-Wshadow", "-Wformat=2", "-O2")


@unittest.skipUnless(sys.platform == "linux", "Native Linux controller")
class ProtectedNativeJournalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiler = shutil.which("cc")
        if not cls.compiler:
            raise unittest.SkipTest("C compiler unavailable")
        cls.temp = tempfile.TemporaryDirectory(prefix="ge04-protected-native-")
        cls.work = Path(cls.temp.name)
        claim = prebirth()
        def literal(value):
            return '"' + value + '"'
        source = r"""
#include "protected-prebirth-journal.h"
#include "protected-attempt-fence.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    struct ge04_prebirth_claim claim = {
        .boot_id = BOOT,
        .attempt = ATTEMPT,
        .nonce = NONCE,
        .source_sha256 = SOURCE,
        .controller_sha256 = CONTROLLER,
    };
    char result[GE04_PREBIRTH_MAX];
    size_t length = 0;
    if (argc != 2) return 90;
    int mode = atoi(argv[1]);
    if (mode == 1) claim.nonce[0] = 'Z';
    if (mode == 2) claim.attempt = 0;
    if (mode == 3) claim.attempt = (1ULL << 63);
    if (mode == 4) claim.boot_id[0] = 'Z';
    if (mode <= 4) {
        int outcome = ge04_prebirth_encode(&claim, result, &length);
        if (mode != 0) return outcome == -1 && errno == EINVAL ? 0 : 91;
        if (outcome != 0) return 92;
        return fwrite(result, 1, length, stdout) == length ? 0 : 93;
    }
    struct ge04_journal_custody held;
    struct ge04_attempt_custody fence;
    ge04_prebirth_custody_init(&held);
    ge04_attempt_custody_init(&fence);
    if (mode == 5) {
        if (ge04_prebirth_stage(&claim, &fence, &held) == 0) return 94;
        if (errno != EPERM) return 95;
        return held.directory_fd == -1 && held.journal_fd == -1 ? 0 : 96;
    }
    if (mode == 6) {
        if (ge04_prebirth_recheck(&claim, &held) == 0) return 97;
        return errno == EPERM ? 0 : 98;
    }
    if (mode == 7) {
        struct ge04_journal_custody unowned = {0};
        ge04_prebirth_close(&unowned);
        return unowned.directory_fd == -1 && unowned.journal_fd == -1 ? 0 : 99;
    }
    if (mode == 8) {
        if (ge04_attempt_begin(&claim, &fence) == 0) return 100;
        if (errno != EPERM) return 101;
        return fence.directory_fd == -1 && fence.fence_fd == -1 ? 0 : 102;
    }
    if (mode == 9) {
        if (ge04_attempt_recheck(&claim, &fence) == 0) return 103;
        return errno == EPERM ? 0 : 104;
    }
    if (mode == 10) {
        char boot[33];
        if (ge04_read_kernel_boot_id(boot) != 0) return 105;
        return fwrite(boot, 1, 32, stdout) == 32 ? 0 : 106;
    }
    if (mode == 11) {
        if (ge04_prebirth_stage(&claim, NULL, &held) == 0) return 107;
        return errno == EPERM ? 0 : 108;
    }
    if (mode == 12 || mode == 13 || mode == 14) {
        claim.attempt = 1;
        if (mode == 13) claim.source_sha256[0] = 'Z';
        if (mode == 14) claim.attempt = 2;
        int result_code = ge04_attempt_fence_encode(&claim, result, &length);
        if (mode != 12) return result_code == -1 && errno == EINVAL ? 0 : 109;
        if (result_code != 0) return 110;
        return fwrite(result, 1, length, stdout) == length ? 0 : 111;
    }
    return 99;
}
"""
        for field, replacement in {
            "boot_id": literal(claim["bootId"]),
            "attempt": str(claim["attempt"]) + "ULL",
            "nonce": literal(claim["nonce"]),
            "source_sha256": literal(claim["sourceSha256"]),
            "controller_sha256": literal(claim["controllerSha256"]),
        }.items():
            target = {
                "boot_id": "BOOT", "attempt": "ATTEMPT",
                "nonce": "NONCE", "source_sha256": "SOURCE",
                "controller_sha256": "CONTROLLER",
            }[field]
            source = source.replace("." + field + " = " + target,
                                    "." + field + " = " + replacement)
        harness = cls.work / "journal-test.c"
        harness.write_text(source)
        cls.executable = cls.work / "journal-test"
        subprocess.run([cls.compiler, *FLAGS, "-I", str(NATIVE),
                        str(harness), str(NATIVE / "protected-prebirth-journal.c"),
                        str(NATIVE / "protected-attempt-fence.c"),
                        "-o", str(cls.executable)], check=True,
                       capture_output=False, text=True)
        cls.controller = cls.work / "controller-held"
        subprocess.run([cls.compiler, *FLAGS,
                        str(NATIVE / "protected-root-controller.c"),
                        str(NATIVE / "protected-prebirth-journal.c"),
                        str(NATIVE / "protected-attempt-fence.c"),
                        "-o", str(cls.controller)], check=True,
                       capture_output=False, text=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "temp"):
            cls.temp.cleanup()

    def invoke(self, mode):
        return subprocess.run([str(self.executable), str(mode)],
                              capture_output=True)

    def test_native_original_bytes_exactly_match_python_contract(self):
        result = self.invoke(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, canonical_prebirth(prebirth()))

    def test_invalid_original_rejected_without_mutation(self):
        for mode in (1, 2, 3, 4):
            with self.subTest(mode=mode):
                result = self.invoke(mode)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_root_only_stage_and_recheck_refuse_unprivileged(self):
        if os.geteuid() == 0:
            self.skipTest("Never execute protected staging under root")
        self.assertEqual(self.invoke(5).returncode, 0)
        self.assertEqual(self.invoke(6).returncode, 0)
        self.assertEqual(self.invoke(7).returncode, 0)
        self.assertEqual(self.invoke(8).returncode, 0)
        self.assertEqual(self.invoke(9).returncode, 0)
        self.assertEqual(self.invoke(11).returncode, 0)

    def test_kernel_boot_id_read_only_matches_procfs(self):
        boot = self.invoke(10)
        self.assertEqual(boot.returncode, 0, boot.stderr)
        expected = (Path("/proc/sys/kernel/random/boot_id")
                    .read_text().strip().replace("-", "").encode("ascii"))
        self.assertEqual(boot.stdout, expected)

    def test_native_attempt_fence_exact_bytes_bind_source_and_controller(self):
        claim = prebirth()
        result = self.invoke(12)
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = ("GE04AF1 " + claim["bootId"] + " " + claim["nonce"] +
                    " " + claim["sourceSha256"] + " " +
                    claim["controllerSha256"] + " 1\n").encode("ascii")
        self.assertEqual(result.stdout, expected)
        for mode in (13, 14):
            with self.subTest(mode=mode):
                self.assertEqual(self.invoke(mode).returncode, 0)

    def test_controller_is_unconditionally_held(self):
        if os.geteuid() == 0:
            self.skipTest("Never execute controller binary under root")
        for args in ((), ("run",), ("--approve",), ("--unsafe",)):
            with self.subTest(args=args):
                run = subprocess.run([str(self.controller), *args],
                                     capture_output=True, timeout=2)
                self.assertEqual(run.returncode, 77)
                self.assertEqual(run.stdout, b"")
