"""Phase 3B: native transaction binding and out-of-order job event tests.

These tests include the production C translation unit to exercise its PRIVATE
job state logic. No bus, privileged execution, unit creation or ACK occurs.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux compiler required")
class NativeJobBindingTests(unittest.TestCase):
    def test_exact_reply_and_jobremoved_permutations_fail_closed(self):
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True, check=False).returncode != 0:
            self.skipTest("libsystemd unavailable")
        source = r"""
#include "protected-systemd-transaction.c"
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

static const char *reply_path, *reply_sender;
static sd_bus *reply_bus;
static uint8_t reply_type;
static uint64_t reply_cookie;
static int reply_signature_ok;

int __wrap_sd_bus_message_get_reply_cookie(sd_bus_message *m, uint64_t *cookie) {
    (void)m; *cookie = reply_cookie; return 0;
}
int __wrap_sd_bus_message_has_signature(sd_bus_message *m, const char *signature) {
    (void)m; return reply_signature_ok && strcmp(signature, "o") == 0;
}

sd_bus *__wrap_sd_bus_message_get_bus(sd_bus_message *m) {
    (void)m; return reply_bus;
}
int __wrap_sd_bus_message_get_type(sd_bus_message *m, uint8_t *type) {
    (void)m; *type = reply_type; return 0;
}
const char *__wrap_sd_bus_message_get_sender(sd_bus_message *m) {
    (void)m; return reply_sender;
}
int __wrap_sd_bus_message_read(sd_bus_message *m, const char *type, ...) {
    (void)m;
    va_list ap; va_start(ap, type);
    if (strcmp(type, "o") != 0) { va_end(ap); return -EINVAL; }
    const char **out = va_arg(ap, const char **);
    *out = reply_path;
    va_end(ap);
    return 1;
}

static struct ge04_systemd_transaction tx;
static const char *fixed = GE04_PREBIRTH_UNIT;
static const char *job = "/org/freedesktop/systemd1/job/42";
static int setup(void) {
    ge04_systemd_transaction_init(&tx);
    tx.bus = (sd_bus *)(uintptr_t)0x1234;
    tx.job_slot = (sd_bus_slot *)(uintptr_t)0x5678;
    tx.subscribed = 1;
    strcpy(tx.owner, ":1.5");
    reply_bus = tx.bus;
    reply_sender = tx.owner;
    reply_type = SD_BUS_MESSAGE_METHOD_RETURN;
    reply_path = job;
    reply_cookie = 17;
    reply_signature_ok = 1;
    return 0;
}
static int bind(void) {
    return ge04_systemd_bind_job_reply(
        &tx, (sd_bus_message *)(uintptr_t)0x4567);
}
static int event(uint32_t id, const char *path, const char *unit,
                 const char *result, const char *sender) {
    return apply_job_event(&tx, id, path, unit, result, sender);
}
int main(int argc, char **argv) {
    if (argc != 2) return 90;
    int mode = atoi(argv[1]);
    setup();
    if (mode == 1) {
        if (event(42, job, fixed, "done", ":1.5") != -1)
            return 11; /* pre-request event */
        return tx.poisoned == 1 ? 0 : 12;
    }
    tx.request_in_flight = 1; /* Only fabricated in this isolated test. */
    tx.request_cookie = 17;
    if (mode == 2) {
        if (event(42, job, fixed, "done", ":1.5") != 0 ||
            !tx.job_seen || tx.job_done_claimed) return 21;
        if (bind() != 0 || !tx.reply_bound || !tx.job_done_claimed)
            return 22;
        return 0;
    }
    if (mode == 3) {
        if (bind() != 0 || tx.job_done_claimed) return 31;
        if (event(42, job, fixed, "done", ":1.5") != 0 ||
            !tx.job_done_claimed) return 32;
        return 0;
    }
    if (mode == 4) {
        if (bind() != 0 || event(42, job, fixed, "done", ":1.5") != 0)
            return 41;
        if (event(42, job, fixed, "done", ":1.5") != -1)
            return 42;
        return tx.poisoned ? 0 : 43;
    }
    if (mode == 5) {
        if (event(43, "/org/freedesktop/systemd1/job/43", fixed,
                  "done", ":1.5") != 0) return 51;
        if (bind() != -1) return 52;
        return tx.poisoned ? 0 : 53;
    }
    if (mode == 6) {
        if (event(42, job, fixed, "failed", ":1.5") != -1)
            return 61;
        return tx.poisoned ? 0 : 62;
    }
    if (mode == 7) {
        if (event(42, job, fixed, "done", ":1.6") != -1)
            return 71;
        return tx.poisoned ? 0 : 72;
    }
    if (mode == 8) {
        if (event(42, "/org/freedesktop/systemd1/job/042", fixed,
                  "done", ":1.5") != -1) return 81;
        return tx.poisoned ? 0 : 82;
    }
    if (mode == 9) {
        reply_sender = ":1.6";
        if (bind() != -1) return 91;
        return tx.poisoned ? 0 : 92;
    }
    if (mode == 10) {
        reply_path = "/org/freedesktop/systemd1/job/4294967296";
        if (bind() != -1) return 101;
        return tx.poisoned ? 0 : 102;
    }
    if (mode == 11) {
        reply_bus = (sd_bus *)(uintptr_t)0x9876;
        if (bind() != -1) return 111;
        return tx.poisoned ? 0 : 112;
    }
    if (mode == 12) {
        reply_type = SD_BUS_MESSAGE_METHOD_ERROR;
        if (bind() != -1) return 121;
        return tx.poisoned ? 0 : 122;
    }
    if (mode == 13) {
        if (bind() != 0 || bind() != -1) return 131;
        return tx.poisoned ? 0 : 132;
    }
    if (mode == 14) {
        if (event(42, job, "another.service", "done", ":1.5") != 0 ||
            tx.poisoned || tx.job_seen) return 141;
        return 0;
    }
    if (mode == 15) {
        if (ge04_systemd_create_exclusive(&tx) != -1 ||
            errno != EPERM || !tx.poisoned || tx.request_in_flight != 1)
            return 151;
        return 0;
    }
    if (mode == 16) {
        reply_path = "/org/freedesktop/systemd1/job/0";
        if (bind() != -1) return 161;
        return tx.poisoned ? 0 : 162;
    }
    if (mode == 17) {
        reply_cookie = 18; /* wrong transaction, same manager and bus */
        if (bind() != -1) return 171;
        return tx.poisoned ? 0 : 172;
    }
    if (mode == 18) {
        reply_signature_ok = 0;
        if (bind() != -1) return 181;
        return tx.poisoned ? 0 : 182;
    }
    if (mode == 19) {
        tx.request_cookie = 0;
        if (bind() != -1) return 191;
        return tx.poisoned ? 0 : 192;
    }
    return 199;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-native-jobbind-") as temp:
            root = Path(temp)
            harness = root / "jobbind.c"
            harness.write_text(source)
            target = root / "jobbind"
            libraries = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                       capture_output=True, text=True,
                                       check=True).stdout.split()
            wrapped = ("sd_bus_message_get_bus", "sd_bus_message_get_type",
                       "sd_bus_message_get_sender", "sd_bus_message_read",
                       "sd_bus_message_get_reply_cookie",
                       "sd_bus_message_has_signature")
            built = subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                 "-I", str(NATIVE), str(harness),
                 str(NATIVE / "protected-attempt-fence.c"),
                 str(NATIVE / "protected-prebirth-journal.c"),
                 *(f"-Wl,--wrap={name}" for name in wrapped),
                 *libraries, "-o", str(target)],
                capture_output=True, text=True, timeout=25)
            self.assertEqual(built.returncode, 0, built.stderr)
            for mode in range(1, 20):
                with self.subTest(mode=mode):
                    result = subprocess.run([str(target), str(mode)],
                                            capture_output=True, timeout=2)
                    self.assertEqual(result.returncode, 0, result.stderr)
