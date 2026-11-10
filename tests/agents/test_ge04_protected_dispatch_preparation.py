"""GE-04 3B4 production C prepared dispatch; no real D-Bus sending.

All positive branch conditions are link-wrapped in an unprivileged process.
The fixed payload's exact shape is independently tested by Phase 3B2.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux compiler required")
class PreparedDispatchTests(unittest.TestCase):
    def test_preparation_is_bound_and_send_is_unreachable(self):
        if os.geteuid() == 0:
            self.skipTest("Never run privileged candidate")
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True).returncode:
            self.skipTest("libsystemd unavailable")
        c = r"""
#include "protected-dispatch-preparation.h"
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int mode, checks, builders, serializations, releases;
static struct ge04_systemd_transaction tx;
static sd_bus_message *dummy = (sd_bus_message *)(uintptr_t)0x4567;
uid_t __wrap_getuid(void) { return mode == 1 ? 1000 : 0; }
uid_t __wrap_geteuid(void) { return mode == 1 ? 1000 : 0; }
gid_t __wrap_getgid(void) { return mode == 1 ? 1000 : 0; }
gid_t __wrap_getegid(void) { return mode == 1 ? 1000 : 0; }
int __wrap_ge04_systemd_recheck_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *original) {
    if (!claim || !attempt || !journal || original != &tx) return -1;
    ++checks;
    return mode == 5 && checks == 2 ? -1 : 0;
}
int __wrap_sd_bus_message_new_method_call(sd_bus *bus,
    sd_bus_message **message, const char *destination, const char *path,
    const char *interface, const char *member) {
    ++builders;
    if (bus != tx.bus || strcmp(destination, ":1.5") ||
        strcmp(path, "/org/freedesktop/systemd1") ||
        strcmp(interface, "org.freedesktop.systemd1.Manager") ||
        strcmp(member, "StartTransientUnit")) return -EINVAL;
    if (mode == 4) return -ENOMEM;
    *message = dummy;
    return 0;
}
int __wrap_ge04_append_fixed_transient_request(sd_bus_message *message) {
    ++serializations;
    if (message != dummy || mode == 6) return -EINVAL;
    return 0;
}
sd_bus *__wrap_sd_bus_message_get_bus(sd_bus_message *message) {
    return message == dummy ? tx.bus : NULL;
}
const char *__wrap_sd_bus_message_get_destination(sd_bus_message *message) {
    (void)message;
    return mode == 7 ? ":1.6" : ":1.5";
}
const char *__wrap_sd_bus_message_get_path(sd_bus_message *message) {
    (void)message;
    return "/org/freedesktop/systemd1";
}
const char *__wrap_sd_bus_message_get_interface(sd_bus_message *message) {
    (void)message;
    return "org.freedesktop.systemd1.Manager";
}
const char *__wrap_sd_bus_message_get_member(sd_bus_message *message) {
    (void)message;
    return "StartTransientUnit";
}
int __wrap_sd_bus_message_has_signature(sd_bus_message *message,
                                         const char *signature) {
    (void)message;
    return mode != 8 && !strcmp(signature, "ssa(sv)a(sa(sv))");
}
sd_bus_message *__wrap_sd_bus_message_unref(sd_bus_message *message) {
    if (message == dummy) ++releases;
    return NULL;
}

int main(int argc, char **argv) {
    if (argc != 2) return 90;
    mode = atoi(argv[1]);
    memset(&tx, 0, sizeof(tx));
    tx.bus = (sd_bus *)(uintptr_t)0x1234;
    tx.job_slot = (sd_bus_slot *)(uintptr_t)0x2345;
    tx.subscribed = 1;
    strcpy(tx.owner, ":1.5");
    struct ge04_prebirth_claim claim = {0};
    struct ge04_attempt_custody attempt = {0};
    struct ge04_journal_custody journal = {0};
    struct ge04_prepared_dispatch prepared;
    ge04_prepared_dispatch_init(&prepared);
    if (prepared.message || prepared.prepared) return 1;
    if (mode == 3) tx.request_in_flight = 1;
    int rc = ge04_prepare_fixed_dispatch(
        &claim, &attempt, &journal, &tx, &prepared);
    if (mode == 2) {
        if (rc || prepared.message != dummy || prepared.prepared != 1 ||
            tx.poisoned || checks != 2 || builders != 1 ||
            serializations != 1 || tx.request_in_flight ||
            tx.request_cookie) return 2;
        if (ge04_dispatch_prepared(&tx, &prepared) != -1 ||
            errno != EPERM || !tx.poisoned || tx.request_cookie)
            return 3;
        ge04_prepared_dispatch_close(&prepared);
        if (releases != 1 || prepared.message || prepared.prepared) return 4;
        ge04_prepared_dispatch_close(&prepared);
        if (releases != 1) return 5;
        return 0;
    }
    if (rc != -1 || errno != EPERM || !tx.poisoned ||
        prepared.message || prepared.prepared ||
        tx.request_cookie) return 6;
    if ((mode == 1 || mode == 3) && (builders || checks)) return 7;
    if (mode == 4 && (builders != 1 || serializations || releases))
        return 8;
    if (mode >= 5 && releases != 1) return 9;
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-dispatch-prep-") as temp:
            dirpath = Path(temp)
            (dirpath / "check.c").write_text(c)
            binary = dirpath / "check"
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            wrappers = ("getuid", "geteuid", "getgid", "getegid",
                        "ge04_systemd_recheck_original",
                        "sd_bus_message_new_method_call",
                        "ge04_append_fixed_transient_request",
                        "sd_bus_message_get_bus",
                        "sd_bus_message_get_destination",
                        "sd_bus_message_get_path",
                        "sd_bus_message_get_interface",
                        "sd_bus_message_get_member",
                        "sd_bus_message_has_signature",
                        "sd_bus_message_unref")
            built = subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                 "-I", str(NATIVE), str(dirpath / "check.c"),
                 str(NATIVE / "protected-dispatch-preparation.c"),
                 *(f"-Wl,--wrap={name}" for name in wrappers),
                 *libs, "-o", str(binary)],
                capture_output=True, text=True, timeout=25)
            self.assertEqual(built.returncode, 0, built.stderr)
            # No unresolved symbol for actual send, call, or ACK.
            symbols = subprocess.run(["nm", "-u", str(binary)],
                                     capture_output=True, text=True,
                                     check=True).stdout
            self.assertNotIn("sd_bus_send", symbols)
            self.assertNotIn("sd_bus_call", symbols)
            for mode in range(1, 9):
                with self.subTest(mode=mode):
                    run = subprocess.run([str(binary), str(mode)],
                                         capture_output=True, timeout=2)
                    self.assertEqual(run.returncode, 0, run.stderr)
