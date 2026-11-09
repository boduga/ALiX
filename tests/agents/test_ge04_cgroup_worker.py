"""Closed disposable-VM qualification; no production worker/broker admission.

Root execution is allowed only from separately reviewed, hash-verified staging.
No watchdog is permitted to kill an uncertain unit. Quarantine preserves it.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
CODE = Path("/run/ge04-cgroup-code")
WORK = Path("/run/ge04-cgroup-qualification")
UNIT = "ge04-r1b2-qualification.service"
PARENT = Path("/sys/fs/cgroup/system.slice") / UNIT
UID = 20002
ENABLED = (sys.platform == "linux" and os.getuid() == 0
           and os.environ.get("ALIX_GE04_PRIVILEGED_QUALIFICATION") == "1"
           and os.environ.get("ALIX_GE04_CGROUP_QUALIFICATION") == "1")
WITNESS = {"ActiveState": "active", "SubState": "running", "MainPID": "981",
           "InvocationID": "76b16df891ea439fb850303c99fdf0be",
           "ExecMainStartTimestampMonotonic": "20927201"}
PROPERTIES = ("LoadState", "ActiveState", "SubState", "Transient", "InvocationID", "MainPID",
              "ControlGroup", "Delegate", "DelegateSubgroup", "KillMode", "OOMPolicy")
EVENTS = {"LEAF", "TEMP", "PUBLISH_FAILED", "INTENT", "CHILD", "STOPPED", "READBACK", "ATTACHED", "RUNNING", "EMPTY"}
STAGE_FILES = {"native/ge04/cgroup-worker-qualification.c": 0o400,
               "tests/agents/test_ge04_cgroup_worker.py": 0o400,
               "bin/probe": 0o500, "manifest.json": 0o400}
STAGE_DIRS = {"native", "native/ge04", "tests", "tests/agents", "bin"}


def run_command(args):
    mutating = args[0] == "/usr/bin/systemd-run" or args[:2] == ["/usr/bin/systemctl", "stop"]
    if mutating:
        print("COMMAND " + json.dumps(args), flush=True)
    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
    if mutating:
        print("COMMAND_EXIT " + str(result.returncode), flush=True)
    result.check_returncode()
    return result.stdout


def show(unit, fields):
    return dict(line.split("=", 1) for line in run_command(
        ["/usr/bin/systemctl", "show", unit, *["--property=" + f for f in fields]]).splitlines())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def custody(path, mode, directory=False):
    s = path.lstat()
    if (s.st_uid != 0 or stat.S_IMODE(s.st_mode) != mode
            or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode))
            or (not directory and s.st_nlink != 1)):
        raise RuntimeError("Untrusted fixture custody: " + str(path))
    return s


def stage_inventory(base):
    root_meta = base.lstat()
    if not stat.S_ISDIR(root_meta.st_mode):
        raise RuntimeError("Staging root is not a directory")
    observed = {"": [root_meta.st_dev, root_meta.st_ino]}
    for path in base.rglob("*"):
        name = str(path.relative_to(base))
        meta = path.lstat()
        if not ((name in STAGE_FILES and stat.S_ISREG(meta.st_mode))
                or (name in STAGE_DIRS and stat.S_ISDIR(meta.st_mode))):
            raise RuntimeError("Unexpected staging entry/type: " + name)
        observed[name] = [meta.st_dev, meta.st_ino]
    if set(observed) != {""} | set(STAGE_FILES) | STAGE_DIRS:
        raise RuntimeError("Unexpected staging entries")
    return observed


def verify_stage_receipt(text, actual):
    if not text or len(text) > 8192:
        raise RuntimeError("Missing/bounded original staging receipt")
    receipt = json.loads(text)
    if (set(receipt) != {"schemaVersion", "entries"} or type(receipt["schemaVersion"]) is not int
            or receipt["schemaVersion"] != 1 or not isinstance(receipt["entries"], dict)
            or set(receipt["entries"]) != set(actual)):
        raise RuntimeError("Invalid original staging receipt")
    for name, pair in receipt["entries"].items():
        if (not isinstance(pair, list) or len(pair) != 2
                or any(type(n) is not int or n < 0 or n > 2**64 - 1 for n in pair)
                or pair[1] == 0 or pair != actual[name]):
            raise RuntimeError("Staging identity changed: " + name)


def stage_binary():
    if ROOT != CODE:
        raise RuntimeError("Root suite requires independently staged sources; repository execution refused")
    actual = stage_inventory(CODE)
    verify_stage_receipt(os.environ.get("ALIX_GE04_STAGE_IDENTITIES", ""), actual)
    for name in {""} | STAGE_DIRS:
        custody(CODE / name, 0o700, True)
    for name, mode in STAGE_FILES.items():
        custody(CODE / name, mode)
    manifest = json.loads((CODE / "manifest.json").read_text())
    if set(manifest) != {"schemaVersion", "sourceSha256", "controllerSha256", "binarySha256"} or type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        raise RuntimeError("Invalid staging manifest")
    for key, name in (("sourceSha256", "native/ge04/cgroup-worker-qualification.c"),
                      ("controllerSha256", "tests/agents/test_ge04_cgroup_worker.py"),
                      ("binarySha256", "bin/probe")):
        if not re.fullmatch("[0-9a-f]{64}", manifest[key]) or digest(CODE / name) != manifest[key]:
            raise RuntimeError("Staging fingerprint mismatch")
    return CODE / "bin/probe"


def process(pid):
    text = Path(f"/proc/{pid}/stat").read_text()
    fields = text[text.rindex(")") + 2:].split()
    status = {}
    for line in Path(f"/proc/{pid}/status").read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            status[key] = value.strip()
    return {"pid": pid, "ticks": int(fields[19]), "state": fields[0], "session": int(fields[3]),
            "uid": tuple(map(int, status["Uid"].split())), "gid": tuple(map(int, status["Gid"].split())),
            "groups": status["Groups"], "nnp": status["NoNewPrivs"],
            "caps": tuple(int(status[k], 16) for k in ("CapInh", "CapPrm", "CapEff", "CapAmb"))}


def synthetic_count():
    return sum(1 for row in run_command(["/usr/bin/ps", "-eo", "uid=,gid="]).splitlines()
               if UID in map(int, row.split()))


def bounded(predicate, seconds=3):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def read_record(name, version):
    path = WORK / name
    custody(path, 0o600)
    raw = path.read_bytes()
    maximum = 256 if version == "GE04A1" else 512
    if not raw or len(raw) > maximum or b"\0" in raw:
        raise RuntimeError("Invalid bounded record")
    text = raw.decode("ascii")
    parts = text.removesuffix("\n").split(" ")
    if (not text.endswith("\n") or parts[0] != version
            or len(parts) != (4 if version == "GE04A1" else 7)
            or not re.fullmatch("[0-9a-f]{32}", parts[1])):
        raise RuntimeError("Invalid record grammar")
    indices = (2, 3) if version == "GE04A1" else (2, 3, 5, 6)
    for i in indices:
        if not re.fullmatch("0|[1-9][0-9]{0,19}", parts[i]) or int(parts[i]) > 2**64 - 1:
            raise RuntimeError("Invalid record number")
    if int(parts[3]) == 0 or (version == "GE04I1" and
                             (not re.fullmatch("worker-[0-9a-f]{16}", parts[4]) or int(parts[6]) == 0)):
        raise RuntimeError("Invalid record identity")
    if (" ".join(parts) + "\n").encode() != raw:
        raise RuntimeError("Noncanonical record")
    return parts, raw


def write_fixture_file(name, raw, exclusive=False):
    flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    fd = os.open(WORK / name, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw); stream.flush(); os.fsync(fd)
    finally:
        os.close(fd)


class _Build:
    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or not shutil.which("cc"):
            raise unittest.SkipTest("Linux compiler required; skip is not qualification")
        if ENABLED:
            cls.binary = stage_binary()
        else:
            temporary = tempfile.TemporaryDirectory(prefix="ge04-cgroup-build-")
            cls.addClassCleanup(temporary.cleanup)
            cls.binary = Path(temporary.name) / "probe"
            subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", "-O2", "-o", str(cls.binary),
                            str(ROOT / "native/ge04/cgroup-worker-qualification.c")],
                           check=True, capture_output=True, timeout=30)


class CgroupBuild(_Build, unittest.TestCase):
    def test_invalid_mode(self):
        for args in ([], ["unknown"], ["run", "/sys/fs/cgroup"], ["run", "20002"]):
            with self.subTest(args=args):
                result = subprocess.run([str(self.binary), *args], capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 64)

    @unittest.skipIf(getattr(os, "getuid", lambda: -1)() == 0, "unprivileged refusal not established by a root run")
    def test_nonroot_refuses_before_writes(self):
        result = subprocess.run([str(self.binary), "run"], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 77)
        self.assertEqual(result.stdout, b"")


class StageLayoutTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ge04-stage-layout-")
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        for name in STAGE_DIRS:
            (self.base / name).mkdir(parents=True, exist_ok=True)
        for name in STAGE_FILES:
            (self.base / name).write_bytes(b"fixture")

    def test_unexpected_empty_directory_rejected(self):
        (self.base / "extra").mkdir()
        with self.assertRaises(RuntimeError):
            stage_inventory(self.base)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO test requires POSIX")
    def test_special_node_rejected(self):
        os.mkfifo(self.base / "extra")
        with self.assertRaises(RuntimeError):
            stage_inventory(self.base)

    def test_same_content_replacement_rejected_by_original_identity(self):
        receipt = json.dumps({"schemaVersion": 1, "entries": stage_inventory(self.base)})
        original = self.base / "bin/probe"
        replacement = self.base / "replacement"
        replacement.write_bytes(original.read_bytes())
        os.replace(replacement, original)
        self.assertEqual(original.read_bytes(), b"fixture")
        with self.assertRaises(RuntimeError):
            verify_stage_receipt(receipt, stage_inventory(self.base))


@unittest.skipUnless(ENABLED, "explicit disposable-root cgroup qualification required; skip is not a pass")
class CgroupLive(_Build, unittest.TestCase):
    created = False
    attempted = False
    initial = None
    keeper = None
    parent_stat = None
    work_stat = None
    parent_fd = None
    quarantined = False
    active_case = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if os.uname().machine != "x86_64":
            raise RuntimeError("Only designated Linux x86-64 qualification")
        custody(Path("/run"), 0o755, True)
        if os.path.lexists(WORK) or os.path.lexists(PARENT):
            raise RuntimeError("Existing qualification state; never adopt")
        if show(UNIT, ("LoadState",))["LoadState"] != "not-found":
            raise RuntimeError("Existing unit; never adopt")
        for database in ("passwd", "group"):
            if subprocess.run(["/usr/bin/getent", database, str(UID)], capture_output=True, timeout=5).returncode != 2:
                raise RuntimeError("Synthetic identity is not unused")
        if synthetic_count() or show("ge04-r2q-witness.service", WITNESS) != WITNESS:
            raise RuntimeError("Host baseline/witness mismatch")
        keeper = Path("/usr/bin/gnusleep")
        s = keeper.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022 or digest(keeper) != "2b1dc0b5878610372193de09e3a9b2dc5e9f4f65cd310765147fc02c0d1c6df9":
            raise RuntimeError("Fixed keeper custody/hash mismatch")
        cls.addClassCleanup(cls.emergency_cleanup)
        cls.attempted = True
        run_command(["/usr/bin/systemd-run", "--no-ask-password", "--unit=" + UNIT,
                     "--property=Delegate=yes", "--property=DelegateSubgroup=controller",
                     "--property=TasksMax=32", "--property=CPUQuota=50%",
                     "--property=KillMode=process", "--property=OOMPolicy=continue", "--", str(keeper), "infinity"])
        cls.created = True
        cls.initial = show(UNIT, PROPERTIES)
        required = {"LoadState": "loaded", "ActiveState": "active", "SubState": "running",
                    "Transient": "yes", "ControlGroup": "/system.slice/" + UNIT,
                    "Delegate": "yes", "DelegateSubgroup": "controller", "KillMode": "process", "OOMPolicy": "continue"}
        if any(cls.initial.get(k) != v for k, v in required.items()) or not re.fullmatch("[0-9a-f]{32}", cls.initial.get("InvocationID", "")):
            cls.quarantined = True
            raise RuntimeError("Unexpected new-unit properties; preserve for review")
        cls.keeper = process(int(cls.initial["MainPID"]))
        if cls.keeper["uid"] != (0, 0, 0, 0):
            cls.quarantined = True
            raise RuntimeError("Unexpected keeper identity")
        cls.parent_fd = os.open(PARENT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        cls.parent_stat = os.fstat(cls.parent_fd)
        cls.verify_unit()
        if (PARENT / "cgroup.procs").read_text() or sorted(p.name for p in PARENT.iterdir() if p.is_dir()) != ["controller"]:
            cls.quarantined = True
            raise RuntimeError("Unclean delegated parent")
        WORK.mkdir(mode=0o700)
        cls.work_stat = WORK.lstat()
        marker = f"GE04A1 {cls.initial['InvocationID']} {cls.parent_stat.st_dev} {cls.parent_stat.st_ino}\n".encode()
        write_fixture_file("approval.v1", marker, True)
        cls.approval_bytes = marker
        fd = os.open(WORK, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        os.fsync(fd); os.close(fd)
        print("UNIT_CREATED " + json.dumps(cls.initial, sort_keys=True), flush=True)

    @classmethod
    def verify_unit(cls):
        current = show(UNIT, PROPERTIES)
        if current != cls.initial:
            raise RuntimeError("Unit identity/properties changed; quarantine")
        actual = process(int(current["MainPID"]))
        if actual["ticks"] != cls.keeper["ticks"] or actual["uid"] != (0, 0, 0, 0):
            raise RuntimeError("Keeper generation changed")
        if Path(f"/proc/{actual['pid']}/cgroup").read_text() != f"0::/system.slice/{UNIT}/controller\n":
            raise RuntimeError("Keeper no longer belongs to its exact controller subgroup")
        current_stat = PARENT.lstat()
        if (not stat.S_ISDIR(current_stat.st_mode) or current_stat.st_uid != 0 or current_stat.st_mode & 0o022
                or (current_stat.st_dev, current_stat.st_ino) != (cls.parent_stat.st_dev, cls.parent_stat.st_ino)):
            raise RuntimeError("Parent identity/custody changed")
        if show("ge04-r2q-witness.service", WITNESS) != WITNESS:
            raise RuntimeError("Witness identity changed")

    @classmethod
    def leaves(cls):
        result = []
        for path in PARENT.iterdir():
            if path.is_dir() and path.name != "controller":
                if path.is_symlink() or not re.fullmatch("worker-[0-9a-f]{16}", path.name):
                    raise RuntimeError("Unexpected delegated directory")
                result.append(path)
        return result

    @classmethod
    def verify_workdir(cls):
        current = custody(WORK, 0o700, True)
        if not cls.work_stat or (current.st_dev, current.st_ino) != (cls.work_stat.st_dev, cls.work_stat.st_ino):
            raise RuntimeError("Private directory identity changed")
        entries = {p.name for p in WORK.iterdir()}
        if not entries <= {"approval.v1", ".lock", "intent.v1", "intent.tmp"} or "approval.v1" not in entries:
            raise RuntimeError("Unknown private artifact; quarantine before teardown")
        for name in entries:
            metadata = custody(WORK / name, 0o600)
            if name == ".lock" and metadata.st_size:
                raise RuntimeError("Invalid lock file")
            if name != ".lock":
                read_record(name, "GE04A1" if name == "approval.v1" else "GE04I1")
        if (WORK / "approval.v1").read_bytes() != cls.approval_bytes:
            raise RuntimeError("Approval changed")

    @classmethod
    def may_stop(cls, expected):
        try:
            cls.verify_unit()
            cls.verify_workdir()
            if expected != cls.initial["InvocationID"] or synthetic_count():
                return False
            if WORK.exists() and ((WORK / "intent.v1").exists() or (WORK / "intent.tmp").exists()):
                return False
            return not cls.leaves() and not (PARENT / "cgroup.procs").read_text()
        except (OSError, RuntimeError, ValueError, UnicodeError, subprocess.SubprocessError):
            return False

    @classmethod
    def emergency_cleanup(cls):
        if cls.created and not cls.quarantined:
            case = cls.active_case
            if case is None:
                case = cls("test_normal_descendants")
                case.pins = []
                case.intent_snapshot = None
                case.record_inode = None
                case.leader = None
                case.recovering = False
            try:
                case.recover_owned_state()
            except BaseException as error:
                cls.quarantined = True
                print("RECOVERY_QUARANTINED " + repr(error), file=sys.stderr, flush=True)
            finally:
                if cls.active_case is None:
                    for fd in case.pins:
                        os.close(fd)
        cls.cleanup_unit()

    @classmethod
    def cleanup_unit(cls):
        if not cls.created:
            if cls.attempted:
                print("SETUP_UNCERTAIN unit=" + UNIT + "; no unverified stop attempted", file=sys.stderr, flush=True)
            return
        if not cls.initial or not cls.keeper or not cls.parent_stat:
            cls.quarantined = True
        if cls.quarantined or not cls.may_stop(cls.initial["InvocationID"]):
            cls.quarantined = True
            print("QUARANTINED unit=" + UNIT + " work=" + str(WORK), file=sys.stderr, flush=True)
            return
        run_command(["/usr/bin/systemctl", "stop", UNIT])
        if not bounded(lambda: not PARENT.exists()):
            raise RuntimeError("Owned unit cgroup did not disappear")
        if WORK.exists():
            entries = {p.name for p in WORK.iterdir()}
            if not entries <= {"approval.v1", ".lock"}:
                raise RuntimeError("Unknown work artifacts; preserve")
            for name in entries:
                custody(WORK / name, 0o600)
                (WORK / name).unlink()
            WORK.rmdir()
        if cls.parent_fd is not None:
            os.close(cls.parent_fd); cls.parent_fd = None
        cls.created = False
        cls.attempted = False
        if show("ge04-r2q-witness.service", WITNESS) != WITNESS or synthetic_count():
            raise RuntimeError("Post-unit cleanup/witness mismatch")
        print("UNIT_REMOVED " + UNIT, flush=True)

    def setUp(self):
        if self.quarantined:
            self.skipTest("Previous uncertainty quarantined; no further mutations")
        self.verify_unit()
        self.pins = []
        self.intent_snapshot = None
        self.record_inode = None
        self.leader = None
        self.recovering = False
        type(self).active_case = self

    def pin_members(self, leaf):
        ids = [int(x) for x in (leaf / "cgroup.procs").read_text().split()]
        self.assertEqual(len(ids), len(set(ids)))
        for pid in ids:
            fd = os.pidfd_open(pid)
            self.pins.append(fd)
            self.assertFalse(select.select([fd], [], [], 0)[0])
        return [process(pid) for pid in ids]

    def observe(self, phase):
        self.verify_unit()
        leaves = self.leaves()
        self.assertEqual(len(leaves), 1, phase)
        leaf = leaves[0]
        s = leaf.lstat()
        self.assertEqual(s.st_uid, 0)
        self.assertFalse(s.st_mode & 0o022)
        ids = [int(x) for x in (leaf / "cgroup.procs").read_text().split()]
        if phase in {"INTENT", "PUBLISH_FAILED", "CHILD", "STOPPED", "READBACK", "ATTACHED", "RUNNING"}:
            self.assertTrue((WORK / "intent.v1").exists(), "Published intent mandatory at " + phase)
            self.assertFalse((WORK / "intent.tmp").exists(), "Temp must have been renamed at " + phase)
        if phase in {"TEMP", "INTENT", "PUBLISH_FAILED", "CHILD", "STOPPED", "READBACK", "ATTACHED", "RUNNING", "EMPTY"}:
            name = "intent.v1" if (WORK / "intent.v1").exists() else "intent.tmp"
            if self.intent_snapshot is not None:
                self.assertTrue((WORK / name).exists(), "Previously observed intent cannot disappear before EMPTY ack")
            if (WORK / name).exists():
                parts, raw = read_record(name, "GE04I1")
                self.assertEqual(parts[1], self.initial["InvocationID"])
                self.assertEqual((int(parts[2]), int(parts[3])), (self.parent_stat.st_dev, self.parent_stat.st_ino))
                self.assertEqual((parts[4], int(parts[5]), int(parts[6])), (leaf.name, s.st_dev, s.st_ino))
                if self.intent_snapshot is None:
                    self.intent_snapshot = raw
                self.assertEqual(raw, self.intent_snapshot)
                metadata = (WORK / name).lstat()
                if self.record_inode is None:
                    self.record_inode = (metadata.st_dev, metadata.st_ino)
                self.assertEqual((metadata.st_dev, metadata.st_ino), self.record_inode)
        if phase in {"LEAF", "TEMP", "INTENT", "PUBLISH_FAILED", "EMPTY"}:
            self.assertEqual(ids, [])
            self.assertIn("populated 0\n", (leaf / "cgroup.events").read_text())
        if phase == "LEAF":
            self.assertFalse((WORK / "intent.v1").exists())
            self.assertFalse((WORK / "intent.tmp").exists())
        if phase == "TEMP":
            self.assertTrue((WORK / "intent.tmp").exists())
            self.assertFalse((WORK / "intent.v1").exists())
        if phase in {"CHILD", "STOPPED", "READBACK", "ATTACHED"}:
            self.assertEqual(len(ids), 1)
            self.assertTrue(bounded(lambda: process(ids[0])["state"] == "T"))
            info = self.pin_members(leaf)[0]
            self.assertEqual(info["uid"], (0, 0, 0, 0))
            self.assertEqual(info["gid"], (0, 0, 0, 0))
            identity = (info["pid"], info["ticks"])
            if self.leader is None:
                self.leader = identity
            self.assertEqual(identity, self.leader)
        if phase == "RUNNING":
            self.assertEqual(len(ids), 2)
            infos = self.pin_members(leaf)
            for info in infos:
                self.assertEqual(info["uid"], (UID,) * 4)
                self.assertEqual(info["gid"], (UID,) * 4)
                self.assertEqual((info["groups"], info["nnp"], info["caps"]), ("", "1", (0,) * 4))
            self.assertEqual(sum(info["pid"] == info["session"] for info in infos), 1)
            self.assertIsNotNone(self.leader)
            self.assertIn(self.leader, [(info["pid"], info["ticks"]) for info in infos])
        if phase == "EMPTY":
            for fd in self.pins:
                self.assertTrue(select.select([fd], [], [], 0)[0], "Observed member must have exited")
        print("OBSERVED " + phase + " " + json.dumps({"leaf": leaf.name, "members": ids}), flush=True)

    def invoke(self, mode, expected, on_phase=None):
        self.verify_unit()
        self.verify_workdir()
        stage_binary()
        if mode == "recover" and (WORK / "intent.v1").exists():
            parts, raw = read_record("intent.v1", "GE04I1")
            if self.intent_snapshot is None:
                self.intent_snapshot = raw
            leaf = PARENT / parts[4]
            if leaf.exists():
                self.pin_members(leaf)
        child = subprocess.Popen([str(self.binary), mode], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        phases, result = [], None
        failed = False
        try:
            while True:
                if not select.select([child.stdout], [], [], 5)[0]:
                    self.fail("Native phase timeout")
                line = child.stdout.readline(256)
                if not line:
                    break
                text = line.decode("ascii").rstrip("\n")
                print("NATIVE " + mode + " " + text, flush=True)
                if text.startswith("EV "):
                    phase = text[3:]
                    self.assertIn(phase, EVENTS)
                    self.observe(phase); phases.append(phase)
                    if on_phase is not None:
                        on_phase(phase)
                    child.stdin.write(b"c"); child.stdin.flush()
                else:
                    self.assertRegex(text, r"^RESULT code=(0|70|77) reason=[A-Z_]+ clean=[01]$")
                    result = text
                    break
            rest, error = child.communicate(timeout=10)
            self.assertEqual(rest, b"")
            self.assertEqual(error, b"")
            self.assertEqual(child.returncode, expected, (mode, phases, result))
            if expected == 88:
                self.assertIsNone(result)
            else:
                self.assertIsNotNone(result)
                self.assertIn(f"code={expected} ", result)
            return phases, result
        except BaseException:
            failed = True
            raise
        finally:
            if child.poll() is None:
                child.stdin.close(); child.stdin = None
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()  # exact fixture-owned helper, never its group/unit
                    child.communicate(timeout=5)
            if failed and not self.recovering:
                try:
                    self.recover_owned_state()
                except BaseException as error:
                    type(self).quarantined = True
                    print("RECOVERY_QUARANTINED " + repr(error), file=sys.stderr, flush=True)

    def assert_clean(self):
        self.assertEqual(self.leaves(), [])
        self.assertFalse((WORK / "intent.v1").exists())
        self.assertFalse((WORK / "intent.tmp").exists())
        self.assertTrue(bounded(lambda: synthetic_count() == 0))
        self.verify_unit()

    def recover_owned_state(self):
        if self.recovering:
            raise RuntimeError("Nested emergency recovery denied")
        if self.quarantined:
            raise RuntimeError("Lost custody already quarantined")
        self.recovering = True
        try:
            self.verify_unit()
            self.verify_workdir()
            if (WORK / "intent.v1").exists():
                read_record("intent.v1", "GE04I1")
                self.invoke("recover", 0)
            elif self.leaves() or (WORK / "intent.tmp").exists():
                self.invoke("sweep-empty", 0)
            self.assert_clean()
        finally:
            self.recovering = False

    def tearDown(self):
        try:
            self.recover_owned_state()
        except BaseException:
            type(self).quarantined = True
            raise
        finally:
            for fd in self.pins:
                os.close(fd)
            type(self).active_case = None

    def crash_then_recover(self, mode, barrier):
        phases, _ = self.invoke(mode, 88)
        self.assertEqual(phases[-1], barrier)
        self.assertTrue((WORK / "intent.v1").exists())
        self.invoke("recover", 0)
        self.assert_clean()

    def test_normal_descendants(self):
        phases, result = self.invoke("run", 0)
        self.assertIn("RUNNING", phases); self.assertIn("clean=1", result); self.assert_clean()

    def test_preclone_denial(self):
        phases, result = self.invoke("fail-before-clone", 77)
        self.assertIn("INTENT", phases); self.assertNotIn("CHILD", phases)
        self.assertIn("reason=BEFORE_CLONE clean=1", result); self.assert_clean()

    def test_publication_failure(self):
        phases, result = self.invoke("fail-publish", 77)
        self.assertIn("PUBLISH_FAILED", phases); self.assertNotIn("CHILD", phases)
        self.assertIn("reason=PUBLISH_EBADF clean=1", result); self.assert_clean()

    def test_attach_failure_stays_stopped(self):
        phases, result = self.invoke("fail-attach", 77)
        self.assertIn("STOPPED", phases); self.assertNotIn("RUNNING", phases)
        self.assertIn("reason=ATTACH_EBADF clean=1", result); self.assert_clean()

    def test_verification_failure_stays_stopped(self):
        phases, result = self.invoke("fail-verify", 77)
        self.assertIn("READBACK", phases); self.assertNotIn("RUNNING", phases)
        self.assertIn("reason=VERIFY_MISMATCH clean=1", result); self.assert_clean()

    def test_resume_failure_stays_stopped(self):
        phases, result = self.invoke("fail-resume", 77)
        self.assertIn("ATTACHED", phases); self.assertNotIn("RUNNING", phases)
        self.assertIn("reason=RESUME_EBADF clean=1", result); self.assert_clean()

    def test_preintent_leaf_crash(self):
        phases, _ = self.invoke("crash-leaf", 88); self.assertEqual(phases, ["LEAF"])
        self.invoke("recover", 77); self.assertEqual(len(self.leaves()), 1)
        self.invoke("sweep-empty", 0); self.assert_clean()

    def test_temp_crash(self):
        phases, _ = self.invoke("crash-temp", 88); self.assertEqual(phases[-1], "TEMP")
        self.invoke("recover", 77); self.assertTrue((WORK / "intent.tmp").exists())
        self.invoke("sweep-empty", 0); self.assert_clean()

    def test_intent_crash(self): self.crash_then_recover("crash-intent", "INTENT")
    def test_stopped_child_crash(self): self.crash_then_recover("crash-child", "CHILD")
    def test_running_crash(self): self.crash_then_recover("crash-running", "RUNNING")

    def mismatch(self, name, transform):
        self.invoke("crash-intent", 88)
        before = (WORK / name).read_bytes()
        leaves = [(p.name, p.stat().st_dev, p.stat().st_ino) for p in self.leaves()]
        changed = transform(before)
        try:
            write_fixture_file(name, changed)
            # For malformed input, native refusal must happen before observer parsing.
            phases, _ = self.invoke_without_record_precheck("recover", 77)
            self.assertEqual(phases, [])
            self.assertEqual((WORK / name).read_bytes(), changed)
            self.assertEqual([(p.name, p.stat().st_dev, p.stat().st_ino) for p in self.leaves()], leaves)
            self.assertEqual(synthetic_count(), 0)
        finally:
            write_fixture_file(name, before)
        self.invoke("recover", 0); self.assert_clean()

    def invoke_without_record_precheck(self, mode, expected, reason=None):
        # Bounded negative-only route: no worker exists and no phase is expected.
        self.verify_unit(); stage_binary()
        for leaf in self.leaves():
            self.assertEqual((leaf / "cgroup.procs").read_text(), "")
            self.assertIn("populated 0\n", (leaf / "cgroup.events").read_text())
        result = subprocess.run([str(self.binary), mode], capture_output=True, timeout=10)
        text = result.stdout.decode("ascii")
        print("NATIVE_NEGATIVE " + text.strip(), flush=True)
        self.assertEqual(result.returncode, expected)
        self.assertNotIn("EV ", text)
        self.assertIn(f"RESULT code={expected} ", text)
        self.assertIn("clean=0", text)
        if reason is not None:
            self.assertIn("reason=" + reason + " ", text)
        return [], text

    def test_malformed_intent(self): self.mismatch("intent.v1", lambda b: b + b"\0junk")
    def test_approval_invocation_mismatch(self):
        wrong = ("0" if self.initial["InvocationID"][0] != "0" else "1") + self.initial["InvocationID"][1:]
        self.mismatch("approval.v1", lambda b: b.replace(self.initial["InvocationID"].encode(), wrong.encode()))
    def test_parent_inode_mismatch(self):
        def mutate(raw):
            parts = raw.decode().strip().split(); parts[3] = str(int(parts[3]) + 1)
            return (" ".join(parts) + "\n").encode()
        self.mismatch("intent.v1", mutate)
    def test_leaf_inode_mismatch(self):
        def mutate(raw):
            parts = raw.decode().strip().split(); parts[6] = str(int(parts[6]) + 1)
            return (" ".join(parts) + "\n").encode()
        self.mismatch("intent.v1", mutate)
    def test_existing_intent_refuses_new_run(self):
        self.invoke("crash-intent", 88); original = (WORK / "intent.v1").read_bytes()
        self.invoke_without_record_precheck("run", 77)
        self.assertEqual((WORK / "intent.v1").read_bytes(), original)
        self.invoke("recover", 0); self.assert_clean()
    def test_concurrent_writer_refuses(self):
        def competitor(phase):
            if phase == "LEAF":
                before = [(p.name, p.stat().st_ino) for p in self.leaves()]
                self.invoke_without_record_precheck("run", 77, "LOCK_DENIED")
                self.assertEqual([(p.name, p.stat().st_ino) for p in self.leaves()], before)
                self.assertEqual(synthetic_count(), 0)
        self.invoke("run", 0, competitor)
        self.assert_clean()

    def test_wrong_unit_identity_never_stops(self):
        wrong = ("0" if self.initial["InvocationID"][0] != "0" else "1") + self.initial["InvocationID"][1:]
        self.assertFalse(self.may_stop(wrong))
        self.verify_unit(); self.assert_clean()

    def test_unknown_private_artifact_prevents_stop(self):
        write_fixture_file("unknown.fixture", b"synthetic", True)
        try:
            self.assertFalse(self.may_stop(self.initial["InvocationID"]))
            self.verify_unit()
        finally:
            (WORK / "unknown.fixture").unlink()
        self.assert_clean()

    def interruption(self, target):
        def interrupt_at(phase):
            if phase == target:
                interrupted(signal.SIGTERM, None)
        with self.assertRaises(KeyboardInterrupt):
            self.invoke("run", 0, interrupt_at)
        self.assertFalse(self.quarantined)
        self.assert_clean()

    def test_interruption_temp(self): self.interruption("TEMP")
    def test_interruption_child(self): self.interruption("CHILD")
    def test_interruption_running(self): self.interruption("RUNNING")

    def test_control_custody_change_preserves_members(self):
        changed = []
        def alter(phase):
            if phase == "RUNNING":
                path = self.leaves()[0] / "cgroup.kill"
                mode = stat.S_IMODE(path.lstat().st_mode)
                changed.append((path, mode))
                os.chmod(path, mode | 0o020)  # root group only; unprivileged rights unchanged
        try:
            phases, result = self.invoke("run", 77, alter)
            self.assertIn("RUNNING", phases)
            self.assertNotIn("EMPTY", phases)
            self.assertIn("reason=QUARANTINE clean=0", result)
            self.assertEqual(len((self.leaves()[0] / "cgroup.procs").read_text().split()), 2)
            for fd in self.pins:
                self.assertFalse(select.select([fd], [], [], 0)[0])
        finally:
            for path, mode in changed:
                os.chmod(path, mode)
        self.invoke("recover", 0); self.assert_clean()

    def test_leaf_custody_change_quarantines(self):
        self.invoke("crash-intent", 88)
        leaf = self.leaves()[0]
        original = stat.S_IMODE(leaf.lstat().st_mode)
        journal = (WORK / "intent.v1").read_bytes()
        try:
            os.chmod(leaf, original | 0o020)  # root group only, no unprivileged write grant
            self.invoke_without_record_precheck("recover", 77, "BINDING_DENIED")
            self.assertEqual((WORK / "intent.v1").read_bytes(), journal)
            self.assertTrue(leaf.exists())
        finally:
            os.chmod(leaf, original)
        self.invoke("recover", 0); self.assert_clean()


def interrupted(_signum, _frame):
    raise KeyboardInterrupt("Qualification interrupted; preserve uncertain ownership")


if __name__ == "__main__":
    if ENABLED:
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
    try:
        unittest.main()
    finally:
        if ENABLED:
            CgroupLive.emergency_cleanup()
