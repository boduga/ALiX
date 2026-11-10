"""Read-only original manager/kernel unit correlation. No privileged test."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
import unit_kernel_observer as observed


class UnitKernelCorrelationTests(unittest.TestCase):
    def test_kernel_grammars_reject_other_scopes_and_mounts(self):
        pid = 123
        raw = (f"{pid} (fixture helper) S " +
               " ".join(["1"] * 18 + ["4567"] + ["1"] * 5) + "\n").encode()
        state, ticks = observed._stat_generation(raw, pid)
        self.assertEqual((state, ticks), ("S", 4567))
        with self.assertRaises(ValueError):
            observed._stat_generation(raw, pid + 1)
        with self.assertRaises(ValueError):
            observed._stat_generation(raw.replace(b" S ", b" Z ", 1), pid)
        mount = b"33 22 0:44 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw\n"
        self.assertEqual(observed._mount(mount), (33, "0:44"))
        for bad in (mount + mount,
                    mount.replace(b"cgroup2", b"tmpfs"),
                    mount.replace(b"/sys/fs/cgroup", b"/tmp"),
                    mount.replace(b" / /sys/", b" /child /sys/")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                observed._mount(bad)

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "pidfd_open"),
                         "Linux descriptor-only fixture")
    def test_bound_kernel_observation_detects_changes_without_authorizing(self):
        with tempfile.TemporaryDirectory(prefix="ge04-unit-kernel-") as tmp:
            root = Path(tmp)
            outer = root / "system.slice" / observed.UNIT
            outer.mkdir(parents=True)
            pid = os.getpid()
            (outer / "cgroup.procs").write_bytes((str(pid) + "\n").encode())
            ancestry = tuple((p.stat().st_dev, p.stat().st_ino)
                             for p in (root, outer.parent, outer))
            original = {"unit": observed.UNIT, "keeperPid": pid,
                        "keeperTicks": 4567, "invocation": "a" * 32,
                        "mountId": 33, "mountDevice": "0:44",
                        "ancestry": ancestry}
            manager = {"unit": observed.UNIT, "mainPid": pid,
                       "invocation": "a" * 32,
                       "controlGroup": "/system.slice/" + observed.UNIT}
            def proc(path, cap):
                if path.endswith("/stat"):
                    return (f"{pid} (test) S " + " ".join(
                        ["1"] * 18 + ["4567"] + ["1"] * 5) + "\n").encode()
                if path.endswith("/cgroup"):
                    return ("0::/system.slice/" + observed.UNIT + "\n").encode()
                if path.endswith("/mountinfo"):
                    return b"33 22 0:44 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n"
                raise ValueError("Unexpected proc path")
            class Poll:
                def register(self, fd, flags):
                    pass
                def poll(self, _):
                    return []
            with (mock.patch.object(observed, "ROOT", str(root)),
                  mock.patch.object(observed, "_read_fixed", side_effect=proc),
                  mock.patch.object(observed.os, "pidfd_open",
                                    side_effect=lambda _pid, _flags: os.open("/dev/null", os.O_RDONLY)),
                  mock.patch.object(observed.select, "poll", return_value=Poll())):
                result = observed.observe_fixed_unit_kernel(original, manager)
                self.assertEqual(result["status"], "UNQUALIFIED_KERNEL_UNIT_CORRELATION")
                self.assertEqual(result["pid"], pid)
                for changed in ({**original, "mountId": 34},
                                {**original, "keeperTicks": 4568},
                                {**original, "ancestry": ancestry[:-1] + ((1, 999),)}):
                    with self.subTest(changed=changed), self.assertRaises(ValueError):
                        observed.observe_fixed_unit_kernel(changed, manager)
                (outer / "cgroup.procs").write_bytes(b"999999\n")
                with self.assertRaises(ValueError):
                    observed.observe_fixed_unit_kernel(original, manager)

    def test_kernel_reads_until_eof_not_first_short_read(self):
        import tempfile
        with tempfile.NamedTemporaryFile() as item:
            payload = b"mountinfo " + b"x" * 5000 + b"\n"
            item.write(payload)
            item.flush()
            real_read = os.read
            with mock.patch.object(observed.os, "read",
                                   side_effect=lambda fd, cap: real_read(fd, min(cap, 27))):
                self.assertEqual(observed._read_fixed(item.name, 6000), payload)
                with self.assertRaises(ValueError):
                    observed._read_fixed(item.name, 4096)

    def test_valid_scheduler_transition_is_not_generation_change(self):
        with tempfile.TemporaryDirectory(prefix="ge04-state-transition-") as tmp:
            root = Path(tmp)
            outer = root / "system.slice" / observed.UNIT
            outer.mkdir(parents=True)
            pid = os.getpid()
            (outer / "cgroup.procs").write_bytes((str(pid) + "\n").encode())
            ancestry = tuple((p.stat().st_dev, p.stat().st_ino)
                             for p in (root, outer.parent, outer))
            original = {"unit": observed.UNIT, "keeperPid": pid,
                        "keeperTicks": 4567, "invocation": "a" * 32,
                        "mountId": 33, "mountDevice": "0:44",
                        "ancestry": ancestry}
            manager = {"unit": observed.UNIT, "mainPid": pid,
                       "invocation": "a" * 32,
                       "controlGroup": "/system.slice/" + observed.UNIT}
            count = [0]
            def proc(path, cap):
                if path.endswith("/stat"):
                    count[0] += 1
                    state = "S" if count[0] == 1 else "R"
                    return (f"{pid} (test) {state} " + " ".join(
                        ["1"] * 18 + ["4567"] + ["1"] * 5) + "\n").encode()
                if path.endswith("/cgroup"):
                    return ("0::/system.slice/" + observed.UNIT + "\n").encode()
                if path.endswith("/mountinfo"):
                    return b"33 22 0:44 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n"
                raise ValueError("Unexpected proc path")
            class Poll:
                def register(self, fd, flags):
                    pass
                def poll(self, _):
                    return []
            with (mock.patch.object(observed, "ROOT", str(root)),
                  mock.patch.object(observed, "_read_fixed", side_effect=proc),
                  mock.patch.object(observed.os, "pidfd_open",
                                    side_effect=lambda _pid, _flags: os.open("/dev/null", os.O_RDONLY)),
                  mock.patch.object(observed.select, "poll", return_value=Poll())):
                self.assertEqual(
                    observed.observe_fixed_unit_kernel(original, manager)["status"],
                    "UNQUALIFIED_KERNEL_UNIT_CORRELATION")

    def test_manager_changes_and_absence_refuse_composite(self):
        base = {"unit": observed.UNIT, "mainPid": 128,
                "invocation": "a" * 32,
                "controlGroup": "/system.slice/" + observed.UNIT}
        def record(owner=":1.5", **changes):
            return {"owner": owner, "properties": {**base, **changes}}
        with mock.patch.object(observed, "observe_fixed_systemd_unit",
                               side_effect=(record(), record(owner=":1.6"))):
            with mock.patch.object(observed, "observe_fixed_unit_kernel",
                                   return_value={"status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION"}):
                with self.assertRaisesRegex(ValueError, "Manager changed"):
                    observed.observe_manager_and_kernel({"keeperPid": 128})
        with mock.patch.object(observed, "observe_fixed_systemd_unit",
                               side_effect=ValueError("NoSuchUnit")):
            with self.assertRaises(ValueError):
                observed.observe_manager_and_kernel({"keeperPid": 128})
