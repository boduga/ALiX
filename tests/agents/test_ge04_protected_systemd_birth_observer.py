"""Native GE-04 Phase 3B3: read-only original-unit snapshot corroboration.

The test exercises production C with unprivileged link-time wrappers.
No real system bus, root operation, unit creation, or phase ACK.
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux C toolchain required")
class NativePostbirthObserverTests(unittest.TestCase):
    def test_stable_and_adversarial_manager_snapshots(self):
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True).returncode:
            self.skipTest("libsystemd unavailable")
        source = r"""
#define _GNU_SOURCE
#include "protected-systemd-birth-observer.h"
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

static int mode, snapshots, rechecks, calls;
static struct ge04_systemd_transaction tx;
static unsigned char invocation[16] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};

int __wrap_ge04_systemd_recheck_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *received) {
    (void)claim; (void)attempt; (void)journal;
    if (received != &tx) return -1;
    ++rechecks;
    return mode == 7 && rechecks == 2 ? -1 : 0;
}
int __wrap_sd_bus_call_method(sd_bus *bus, const char *owner,
    const char *path, const char *iface, const char *method,
    sd_bus_error *error, sd_bus_message **reply, const char *types, ...) {
    (void)bus; (void)owner; (void)path; (void)iface;
    (void)error; (void)types;
    if (strcmp(method, "GetUnit") != 0) return -EINVAL;
    ++calls;
    if (mode == 8) return -EIO;
    *reply = (sd_bus_message *)1;
    return 1;
}
int __wrap_sd_bus_message_read(sd_bus_message *msg,
    const char *types, ...) {
    (void)msg;
    if (strcmp(types, "o") != 0) return -EINVAL;
    va_list ap; va_start(ap, types);
    const char **out = va_arg(ap, const char **);
    *out = mode == 2 ?
        "/org/freedesktop/systemd1/unit/other_2eservice" :
        "/org/freedesktop/systemd1/unit/ge04_2dr1b2_2dview_2dqualification_2eservice";
    va_end(ap);
    return 1;
}
sd_bus_message *__wrap_sd_bus_message_unref(sd_bus_message *message) {
    (void)message; return NULL;
}
int __wrap_sd_bus_get_property_string(sd_bus *bus, const char *owner,
    const char *path, const char *iface, const char *prop,
    sd_bus_error *error, char **value) {
    (void)bus; (void)owner; (void)path; (void)iface; (void)error;
    const char *data = NULL;
    if (strcmp(prop, "Id") == 0) {
        ++snapshots;
        data = "ge04-r1b2-view-qualification.service";
    } else if (strcmp(prop, "LoadState") == 0) data = "loaded";
    else if (strcmp(prop, "ActiveState") == 0)
        data = mode == 11 ? "inactive" : "active";
    else if (strcmp(prop, "SubState") == 0) data = "running";
    else if (strcmp(prop, "ControlGroup") == 0)
        data = mode == 3 ? "/system.slice/other.service" :
            "/system.slice/ge04-r1b2-view-qualification.service";
    else return -EINVAL;
    *value = strdup(data);
    return *value ? 1 : -ENOMEM;
}
int __wrap_sd_bus_get_property_trivial(sd_bus *bus, const char *owner,
    const char *path, const char *iface, const char *prop,
    sd_bus_error *error, char type, void *out) {
    (void)bus; (void)owner; (void)path; (void)iface; (void)error;
    if (type != 'u') return -EINVAL;
    uint32_t *value = out;
    if (strcmp(prop, "MainPID") == 0)
        *value = mode == 4 && snapshots == 2 ? 124 : 123;
    else if (strcmp(prop, "NRestarts") == 0)
        *value = mode == 6 ? 1 : 0;
    else return -EINVAL;
    return 1;
}
int __wrap_sd_bus_get_property(sd_bus *bus, const char *owner,
    const char *path, const char *iface, const char *prop,
    sd_bus_error *error, sd_bus_message **reply, const char *type) {
    (void)bus; (void)owner; (void)path; (void)iface; (void)error;
    if (strcmp(prop, "InvocationID") || strcmp(type, "ay"))
        return -EINVAL;
    *reply = (sd_bus_message *)1;
    return 1;
}
int __wrap_sd_bus_message_read_array(sd_bus_message *message, char type,
                                    const void **out, size_t *size) {
    (void)message;
    if (type != 'y') return -EINVAL;
    invocation[0] = mode == 9 ? 0 : mode == 5 && snapshots == 2 ? 99 : 1;
    if (mode == 9) memset(invocation, 0, sizeof(invocation));
    *out = invocation; *size = mode == 10 ? 15 : sizeof(invocation);
    return 1;
}

int main(int argc, char **argv) {
    if (argc != 2) return 90;
    mode = atoi(argv[1]);
    memset(&tx, 0, sizeof(tx));
    tx.bus = (sd_bus *)1;
    tx.job_slot = (sd_bus_slot *)1;
    strcpy(tx.owner, ":1.5");
    tx.subscribed = 1;
    tx.request_in_flight = 1;
    tx.request_cookie = 17;
    tx.reply_bound = 1;
    tx.job_seen = 1;
    tx.job_done_claimed = mode == 12 ? 0 : 1;
    struct ge04_prebirth_claim claim = {0};
    struct ge04_attempt_custody attempt = {0};
    struct ge04_journal_custody journal = {0};
    struct ge04_unqualified_birth_view view = {0};
    int rc = ge04_observe_unqualified_postbirth(
        &claim, &attempt, &journal, &tx, &view);
    if (mode == 1) {
        if (rc != 0 || tx.poisoned || !view.unqualified ||
            view.main_pid != 123 ||
            strcmp(view.invocation, "0102030405060708090a0b0c0d0e0f10") ||
            snapshots != 2 || rechecks != 3) return 1;
    } else {
        if (rc != -1 || !tx.poisoned || view.unqualified ||
            view.main_pid || view.invocation[0]) return 2;
        if (mode == 12 && calls != 0) return 3;
    }
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-native-birth-") as temp:
            path = Path(temp)
            harness = path / "test.c"
            harness.write_text(source)
            target = path / "test"
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            wrappers = ("ge04_systemd_recheck_original", "sd_bus_call_method",
                        "sd_bus_message_read", "sd_bus_message_unref",
                        "sd_bus_get_property_string", "sd_bus_get_property_trivial",
                        "sd_bus_get_property", "sd_bus_message_read_array")
            cmd = ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                   "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                   "-I", str(NATIVE), str(harness),
                   str(NATIVE / "protected-systemd-birth-observer.c"),
                   str(NATIVE / "protected-systemd-transaction.c"),
                   str(NATIVE / "protected-prebirth-journal.c"),
                   str(NATIVE / "protected-attempt-fence.c"),
                   *(f"-Wl,--wrap={name}" for name in wrappers),
                   *libs, "-o", str(target)]
            compile_result = subprocess.run(cmd, capture_output=True,
                                            text=True, timeout=25)
            self.assertEqual(compile_result.returncode, 0,
                             compile_result.stderr)
            for case in range(1, 13):
                with self.subTest(case=case):
                    run = subprocess.run([str(target), str(case)],
                                         capture_output=True, timeout=2)
                    self.assertEqual(run.returncode, 0, run.stderr)
