"""Unprivileged direct native ACK frame protocol test; no root, cgroup or unit."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[2] /
          "tests/fixtures/ge04-ack-frame-probe.c")
TOKEN = "a" * 32


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux native compiler required")
class NativeAckFrameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="ge04-ack-frame-")
        cls.binary = str(Path(cls.work.name) / "ack-probe")
        result = subprocess.run(
            ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
             str(SOURCE), "-o", cls.binary],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=15)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace"))

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def probe(self, frames, two=False, expected=None):
        # The test fixture calls event_until ONLY, never native privileged main.
        process = subprocess.Popen(
            [self.binary, "two" if two else "phase"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, bufsize=0)
        try:
            self.assertTrue(process.stdout.readline().startswith(b"EV INTENT "))
            process.stdin.write(frames[0])
            process.stdin.flush()
            result = process.stdout.readline().strip()
            self.assertTrue(result.startswith(b"ACK_RESULT "), result)
            if two and result == b"ACK_RESULT 1 1":
                self.assertTrue(process.stdout.readline().startswith(b"EV PRE_NAMESPACE "))
                process.stdin.write(frames[1])
                process.stdin.flush()
                result2 = process.stdout.readline().strip()
                self.assertEqual(result2,
                                 b"ACK_RESULT 1 2" if expected else b"ACK_RESULT 0 1")
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
            return result
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()

    def test_valid_exact_ack_and_ordered_second_phase(self):
        first = f"GE04ACK1 {TOKEN} INTENT 1\n".encode()
        second = f"GE04ACK1 {TOKEN} PRE_NAMESPACE 2\n".encode()
        self.assertEqual(self.probe([first, second], two=True, expected=True),
                         b"ACK_RESULT 1 1")

    def test_mismatched_or_replayed_frames_fail(self):
        invalid = (
            b"c",
            f"GE04ACK1 {TOKEN} INTENT 0\n".encode(),
            f"GE04ACK1 {TOKEN} INTENT 2\n".encode(),
            f"GE04ACK1 {'b'*32} INTENT 1\n".encode(),
            f"GE04ACK1 {TOKEN} PRE_NAMESPACE 1\n".encode(),
            f"GE04ACK1 {TOKEN} INTENT 1\r\n".encode(),
            f"GE04ACK1 {TOKEN} INTENT 1\n".encode() * 2,
        )
        for frame in invalid:
            with self.subTest(frame=frame[:30]):
                self.assertEqual(self.probe([frame]), b"ACK_RESULT 0 0")
        first = f"GE04ACK1 {TOKEN} INTENT 1\n".encode()
        replay = f"GE04ACK1 {TOKEN} INTENT 1\n".encode()
        self.assertEqual(self.probe([first, replay], two=True, expected=False),
                         b"ACK_RESULT 1 1")
