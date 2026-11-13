"""GE-04 Phase 4A3: native mount namespace and mountinfo source tests.

Read-only procfs inspection and native parser edge cases as nonroot.
No root entrypoint, setns, mount changes, cgroups writes, or ACKs.
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
                     shutil.which("pkg-config"), "Linux C toolchain")
class MountNamespaceTests(unittest.TestCase):
    def test_parser_and_root_only_refusal(self):
        if os.geteuid() == 0:
            self.skipTest("No root invocation permitted")
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True).returncode:
            self.skipTest("libsystemd unavailable")
        c = r"""
#include "protected-mount-namespace.c"
#include <stdlib.h>

int main(void) {
    const char normal[] =
      "34 25 0:29 / /sys/fs/cgroup rw,nosuid,nodev,noexec shared:9 - "
      "cgroup2 cgroup2 rw,nsdelegate\n";
    const char duplicate[] =
      "34 25 0:29 / /sys/fs/cgroup rw shared:9 - cgroup2 cgroup2 rw\n"
      "34 25 0:29 / /sys/fs/cgroup rw shared:9 - cgroup2 cgroup2 rw\n";
    const char wrongroot[] =
      "34 25 0:29 /sub /sys/fs/cgroup rw - cgroup2 cgroup2 rw\n";
    const char wrongfs[] =
      "34 25 0:29 / /sys/fs/cgroup rw - tmpfs tmpfs rw\n";
    if (parse_mountinfo(normal, sizeof(normal)-1, 34) != 0) return 1;
    if (parse_mountinfo(normal, sizeof(normal)-1, 35) == 0) return 2;
    if (parse_mountinfo(duplicate, sizeof(duplicate)-1, 34) == 0) return 3;
    if (parse_mountinfo(wrongroot, sizeof(wrongroot)-1, 34) == 0) return 4;
    if (parse_mountinfo(wrongfs, sizeof(wrongfs)-1, 34) == 0) return 5;
    if (parse_mountinfo(normal, sizeof(normal)-2, 34) == 0) return 6;
    uint64_t id = 0;
    if (decimal_id("4294967296", 10, &id) < 0 || id != 4294967296ULL)
        return 7;
    if (decimal_id("034", 3, &id) == 0 ||
        decimal_id("18446744073709551616", 20, &id) == 0 ||
        decimal_id("-1", 2, &id) == 0) return 8;

    struct ge04_mount_namespace_custody held;
    ge04_mount_namespace_init(&held);
    if (held.keeper_ns_fd != -1 || held.controller_ns_fd != -1 ||
        held.held || held.ns_inode) return 9;
    int fd = open("/proc/self/ns/mnt", O_RDONLY|O_CLOEXEC);
    dev_t dev = 0;
    ino_t inode = 0;
    if (fd < 0 || namespace_id(fd, &dev, &inode) < 0 ||
        !dev || !inode) return 10;
    close(fd);
    fd = open_keeper_namespace(getpid());
    if (fd < 0 || namespace_id(fd, &dev, &inode) < 0) return 11;
    close(fd);
    if (ge04_mount_namespace_pin_unqualified(NULL,NULL,&held) == 0 ||
        errno != EPERM) return 12;
    if (ge04_mount_namespace_recheck_unqualified(NULL,NULL,&held) == 0 ||
        errno != EPERM) return 13;
    /* Borrowed handles must survive cleanup; no foreign FD ownership. */
    held.keeper_ns_fd = 1;
    ge04_mount_namespace_close(&held);
    if (held.keeper_ns_fd != -1 || fcntl(1,F_GETFD) < 0) return 14;
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-mount-ns-") as tmp:
            path = Path(tmp)
            (path / "check.c").write_text(c)
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            compiled = subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                 "-I", str(NATIVE), str(path / "check.c"),
                 *(str(NATIVE / name) for name in (
                     "protected-cgroup-custody.c",
                     "protected-keeper-custody.c",
                     "protected-systemd-birth-observer.c",
                     "protected-systemd-transaction.c",
                     "protected-prebirth-journal.c",
                     "protected-attempt-fence.c")),
                 *libs, "-o", str(path / "check")],
                capture_output=True, text=True, timeout=25)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(path / "check")],
                                    capture_output=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
