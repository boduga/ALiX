import importlib.util
from pathlib import Path
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("ge04-q32-syscall-linearization-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Tests(unittest.TestCase):
    def setUp(self):
        self.supervisor = probe.ScratchSupervisor()

    def tearDown(self):
        self.supervisor.close()

    def test_revoke_first_blocks_actual_syscall(self):
        self.assertTrue(self.supervisor.revoke())
        self.assertFalse(self.supervisor.effect("n"))
        self.assertEqual(self.supervisor.snapshot()["bytes"], b"")

    def test_effect_lock_spans_real_syscall_and_revoke_waits(self):
        in_effect, resume, revoking, revoked = (threading.Event() for _ in range(4))
        results = {}
        def effect():
            results["effect"] = self.supervisor.effect("n", entered=in_effect, release=resume)
        def revoke():
            self.supervisor.revoke(entered=revoking)
            revoked.set()
        a = threading.Thread(target=effect)
        b = threading.Thread(target=revoke)
        a.start()
        self.assertTrue(in_effect.wait(5))
        b.start()
        self.assertTrue(revoking.wait(5))
        # Revocation cannot complete while syscall's critical section is held.
        self.assertFalse(revoked.wait(0.05))
        resume.set()
        a.join(5)
        b.join(5)
        self.assertFalse(a.is_alive() or b.is_alive())
        self.assertTrue(results["effect"])
        self.assertTrue(revoked.is_set())
        self.assertEqual(self.supervisor.snapshot()["bytes"], b"X")
        self.assertFalse(self.supervisor.effect("other"))
        self.assertEqual(self.supervisor.snapshot()["bytes"], b"X")

    def test_replay_and_concurrent_single_use(self):
        outcomes = []
        threads = [threading.Thread(target=lambda: outcomes.append(self.supervisor.effect("n"))) for _ in range(12)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(5)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(outcomes.count(True), 1)
        self.assertEqual(self.supervisor.snapshot()["bytes"], b"X")

    def test_closed_and_invalid_fail_closed(self):
        self.assertFalse(self.supervisor.effect(""))
        self.assertFalse(self.supervisor.effect(None))
        self.supervisor.close()
        self.assertFalse(self.supervisor.effect("n"))


if __name__ == "__main__":
    unittest.main()
