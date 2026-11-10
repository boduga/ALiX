"""GE-04 Phase 3B4B original pre-send intent: native source tests only.

No privileged calls, no filesystem journal writes and no systemd sends.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux compiler required")
class ProtectedDispatchIntentTests(unittest.TestCase):
    def test_exact_original_record_and_nonroot_refusal(self):
        if os.geteuid() == 0:
            self.skipTest("Never execute candidate as root")
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True).returncode:
            self.skipTest("libsystemd unavailable")
        c = r"""
#include "protected-dispatch-intent.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc != 2) return 80;
    int mode = argv[1][0] - '0';
    struct ge04_prebirth_claim claim = {0};
    memset(claim.boot_id, 'a', 32);
    memset(claim.nonce, 'b', 64);
    memset(claim.source_sha256, 'c', 64);
    memset(claim.controller_sha256, 'd', 64);
    claim.attempt = 1;
    char text[GE04_DISPATCH_INTENT_MAX];
    size_t length;
    const char *owner = ":1.25";
    if (mode == 1) {
        if (ge04_dispatch_intent_encode(&claim, owner, text, &length))
            return 1;
        const char *expected =
            "GE04DI1 "
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc "
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd "
            ":1.25 1 ge04-r1b2-view-qualification.service fail PRE_SEND_INTENT\n";
        if (length != strlen(expected) || memcmp(text, expected, length))
            return 2;
        return 0;
    }
    if (mode == 2) owner = "org.freedesktop.systemd1";
    if (mode == 3) claim.attempt = 2;
    if (mode == 4) claim.nonce[0] = 'Z';
    if (mode >= 2 && mode <= 4) {
        if (ge04_dispatch_intent_encode(&claim, owner, text, &length) == 0 ||
            errno != EINVAL) return 3;
        return 0;
    }
    if (mode == 5) {
        struct ge04_dispatch_intent_custody held;
        ge04_dispatch_intent_init(&held);
        if (ge04_dispatch_intent_recheck(&claim, ":1.25", &held) == 0 ||
            errno != EPERM) return 4;
        if (ge04_dispatch_intent_stage(
            &claim, NULL, NULL, NULL, NULL, &held) == 0 ||
            errno != EPERM) return 5;
        ge04_dispatch_intent_close(&held);
        return held.intent_fd == -1 && held.directory_fd == -1 ? 0 : 6;
    }
    if (mode == 6) {
        struct ge04_dispatch_intent_custody held;
        ge04_dispatch_intent_init(&held);
        held.intent_fd = 1;
        ge04_dispatch_intent_close(&held);
        return held.intent_fd == -1 && fcntl(1, F_GETFD) >= 0 ? 0 : 7;
    }
    return 81;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-dispatch-intent-") as tmp:
            root = Path(tmp)
            (root / "check.c").write_text(c)
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            command = ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra",
                       "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow",
                       "-Wformat=2", "-I", str(NATIVE), str(root / "check.c"),
                       *(str(NATIVE / name) for name in (
                           "protected-dispatch-intent.c",
                           "protected-dispatch-preparation.c",
                           "protected-systemd-request.c",
                           "protected-systemd-transaction.c",
                           "protected-attempt-fence.c",
                           "protected-prebirth-journal.c")),
                       *libs, "-o", str(root / "check")]
            compile_result = subprocess.run(command, capture_output=True,
                                            text=True, timeout=25)
            self.assertEqual(compile_result.returncode, 0,
                             compile_result.stderr)
            for mode in range(1, 7):
                with self.subTest(mode=mode):
                    result = subprocess.run([str(root / "check"), str(mode)],
                                            capture_output=True, timeout=2)
                    self.assertEqual(result.returncode, 0, result.stderr)
