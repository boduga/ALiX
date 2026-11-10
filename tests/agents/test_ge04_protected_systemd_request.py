"""GE-04 phase 3B2 native fixed transient payload (NO D-Bus sends).

Unprivileged link-time wrappers record the exact serializer calls. No root,
live system bus connection, service creation or controller activation.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux C toolchain")
class FixedSystemdPayloadTests(unittest.TestCase):
    def test_exact_fixed_payload_and_failure_refusal(self):
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True, check=False).returncode != 0:
            self.skipTest("libsystemd unavailable")
        code = r"""
#include "protected-systemd-request.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static char actions[120][256];
static int step, depth, fail_at;
static void note(const char *prefix, const char *value) {
    if (step >= 120) abort();
    snprintf(actions[step++], sizeof(actions[0]), "%s%s",
             prefix, value ? value : "");
}
int __wrap_sd_bus_message_open_container(sd_bus_message *m, char type,
                                          const char *contents) {
    (void)m;
    char op[3] = {type, ':', 0};
    note(op, contents);
    depth++;
    if (step == fail_at) return -EIO;
    return 0;
}
int __wrap_sd_bus_message_close_container(sd_bus_message *m) {
    (void)m;
    note("C", "");
    depth--;
    if (depth < 0) abort();
    if (step == fail_at) return -EIO;
    return 0;
}
int __wrap_sd_bus_message_append(sd_bus_message *m, const char *types, ...) {
    (void)m;
    va_list args;
    va_start(args, types);
    if (!strcmp(types, "ss")) {
        const char *a = va_arg(args, const char *);
        const char *b = va_arg(args, const char *);
        note("ss:", a);
        note("ss:", b);
    } else if (!strcmp(types, "s")) {
        const char *a = va_arg(args, const char *);
        note("s:", a);
    } else if (!strcmp(types, "b")) {
        int a = va_arg(args, int);
        note(a == 1 ? "b:1" : "b:0", "");
    } else abort();
    va_end(args);
    if (step >= fail_at && fail_at > 0) return -EIO;
    return 0;
}
int main(void) {
    if (ge04_append_fixed_transient_request(NULL) != -1 || errno != EINVAL)
        return 1;
    sd_bus_message *dummy = (sd_bus_message *)1;
    if (ge04_append_fixed_transient_request(dummy) != 0 || depth != 0)
        return 2;
    static const char *expected[] = {
        "ss:" GE04_PREBIRTH_UNIT, "ss:fail",
        "a:(sv)",
        "r:sv", "s:Description", "v:s", "s:ALiX GE-04 qualification keeper",
        "C", "C",
        "r:sv", "s:Type", "v:s", "s:exec", "C", "C",
        "r:sv", "s:NoNewPrivileges", "v:b", "b:1", "C", "C",
        "r:sv", "s:Delegate", "v:b", "b:1", "C", "C",
        "r:sv", "s:ExecStart", "v:a(sasb)", "a:(sasb)",
        "r:sasb", "s:" GE04_KEEPER_CANDIDATE,
        "a:s", "s:" GE04_KEEPER_CANDIDATE, "C", "b:0",
        "C", "C", "C", "C", "C",
        "a:(sa(sv))", "C"
    };
    if (step != (int)(sizeof(expected) / sizeof(expected[0]))) return 3;
    for (int i = 0; i < step; i++) {
        if (strcmp(actions[i], expected[i])) {
            fprintf(stderr, "mismatch %d: %s != %s\n", i,
                    actions[i], expected[i]);
            return 4;
        }
    }
    int all_steps = step;
    /* Every injected native append/container error must terminate
     * serialization rather than resuming after a failed API call. */
    for (int i = 1; i <= all_steps; i++) {
        step = 0; depth = 0; fail_at = i;
        int result = ge04_append_fixed_transient_request(dummy);
        if (result >= 0) return 5;
    }
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-fixed-payload-") as tmp:
            root = Path(tmp)
            harness = root / "check.c"
            harness.write_text(code)
            binary = root / "check"
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            compiled = subprocess.run(
                ["cc", "-std=gnu11", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                 "-O2", "-I", str(NATIVE), str(harness),
                 str(NATIVE / "protected-systemd-request.c"),
                 "-Wl,--wrap=sd_bus_message_open_container",
                 "-Wl,--wrap=sd_bus_message_close_container",
                 "-Wl,--wrap=sd_bus_message_append", *libs,
                 "-o", str(binary)],
                capture_output=True, text=True, timeout=25)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            run = subprocess.run([str(binary)], capture_output=True, timeout=2)
            self.assertEqual(run.returncode, 0, run.stderr)
