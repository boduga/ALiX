"""Phase 4A2 native cgroup2 mount and ancestry custody (unprivileged).

Compiles production C, opens only read-only cgroup2 paths or disposable
user-owned test directories. No root, writes to controls, or unit birth.
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
                     shutil.which("pkg-config"), "Linux native toolchain")
class CgroupDescriptorCustodyTests(unittest.TestCase):
    def _run_native(self, mode):
        if os.geteuid() == 0:
            self.skipTest("No privileged test permitted")
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True).returncode:
            self.skipTest("libsystemd unavailable")
        code = r"""
#include "protected-cgroup-custody.c"
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 2) return 90;
    struct ge04_cgroup_custody held;
    ge04_cgroup_custody_init(&held);
    if (held.held || held.root_fd != -1 || held.slice_fd != -1 ||
        held.unit_fd != -1 || held.root.mount_id) return 1;
    if (!strcmp(argv[1], "deny")) {
        held.root_fd = 1; /* borrowed stdout must not be closed */
        if (ge04_cgroup_recheck_unqualified(NULL, &held) == 0 ||
            errno != EPERM) return 12;
        if (ge04_cgroup_pin_unqualified(NULL,NULL,NULL,NULL,NULL,&held) == 0 ||
            errno != EPERM) return 13;
        ge04_cgroup_custody_close(&held);
        if (held.root_fd != -1 || held.held) return 14;
        if (fcntl(1, F_GETFD) == -1) return 15;
        return 0;
    }
    if (strcmp(argv[1], "live")) return 91;
    struct ge04_cgroup_identity root = {0}, slice = {0}, fake = {0};
    int fd = fixed_root_open();
    if (fd < 0 || snapshot(fd, &root) < 0 || !root.mount_id ||
        !root.inode || !root.device) return 2;
    int again = fixed_root_open();
    if (again < 0 || snapshot(again, &fake) < 0 ||
        !same(&root, &fake)) return 3;
    close(again);
    int child = openat(fd, "system.slice",
        O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    if (child < 0 || snapshot(child, &slice) < 0 ||
        slice.mount_id != root.mount_id ||
        slice.device != root.device ||
        slice.inode == root.inode ||
        name_binds(fd, "system.slice", child) < 0) return 4;
    if (name_binds(fd, "system.slice", fd) == 0 ||
        name_binds(fd, "../system.slice", child) == 0 ||
        name_binds(fd, argv[1], child) == 0) return 5;
    fake = root;
    fake.mount_id++;
    if (same(&fake, &root)) return 6;
    int outside = open("/tmp", O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    if (outside < 0 || snapshot(outside, &fake) == 0) return 7;
    close(outside);
    /* Rechecking an unowned or unprivileged chain must not promote it. */
    held.root_fd = fd;
    held.slice_fd = child;
    held.held = 0;
    if (ge04_cgroup_recheck_unqualified(NULL, &held) == 0 ||
        errno != EPERM) return 8;
    if (ge04_cgroup_pin_unqualified(NULL,NULL,NULL,NULL,NULL,&held) == 0 ||
        errno != EPERM) return 9;
    /* Do not close foreign-owned descriptors through the custody API. */
    ge04_cgroup_custody_close(&held);
    if (held.root_fd != -1 || held.slice_fd != -1) return 10;
    if (fstat(fd, &(struct stat){0}) < 0) return 11;
    close(child);
    close(fd);
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-cgroup-custody-") as tmp:
            root = Path(tmp)
            target = root / "check"
            harness = root / "check.c"
            harness.write_text(code)
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  check=True, capture_output=True,
                                  text=True).stdout.split()
            command = ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra",
                       "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow",
                       "-Wformat=2", "-I", str(NATIVE), str(harness),
                       *(str(NATIVE / name) for name in (
                           "protected-keeper-custody.c",
                           "protected-systemd-birth-observer.c",
                           "protected-systemd-transaction.c",
                           "protected-prebirth-journal.c",
                           "protected-attempt-fence.c")),
                       *libs, "-o", str(target)]
            built = subprocess.run(command, capture_output=True,
                                   text=True, timeout=25)
            self.assertEqual(built.returncode, 0, built.stderr)
            result = subprocess.run([str(target), mode],
                                    capture_output=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_unprivileged_refusal_and_borrowed_fd_safety(self):
        self._run_native("deny")

    def test_actual_cgroup2_mount_and_ancestry_when_host_allows(self):
        base = Path("/sys/fs/cgroup")
        slice_dir = base / "system.slice"
        if (not base.is_dir() or not slice_dir.is_dir() or
                base.stat().st_uid != 0 or base.stat().st_gid != 0 or
                slice_dir.stat().st_uid != 0 or slice_dir.stat().st_gid != 0):
            self.skipTest("Host does not expose root-owned system.slice cgroup2")
        self._run_native("live")
