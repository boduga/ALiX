import importlib.util
from pathlib import Path
import os
import select
import signal
import subprocess
import sys
import tempfile
import unittest
P = Path(__file__).with_name('ge04-q32-inert-crash-worker.py')
J = Path(__file__).with_name('ge04-q32-inert-effect-journal.py')
spec = importlib.util.spec_from_file_location('ge04_inert_journal', J)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

class CrashTests(unittest.TestCase):
    def kill_at_checkpoint(self, checkpoint):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'scratch.sqlite'
            p = subprocess.Popen([sys.executable, '-B', str(P), '--isolated-test',
                                  '--database', str(path), '--checkpoint', checkpoint],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                ready, _, _ = select.select([p.stdout], [], [], 8)
                self.assertTrue(ready, 'worker did not reach checkpoint')
                self.assertEqual(p.stdout.readline().strip(), 'CHECKPOINT:' + checkpoint)
                self.assertIsNone(p.poll(), 'worker exited before kill')
                p.kill()
                self.assertEqual(p.wait(timeout=5), -signal.SIGKILL)
                with m.connect(path) as db:
                    expected = 'ABORTED' if checkpoint == 'intent' else 'UNKNOWN_RECOVERY'
                    self.assertEqual(m.recover(db, 'synthetic-crash-attempt'), expected)
                    self.assertFalse(m.begin(db, 'synthetic-crash-attempt', 1))
                    self.assertFalse(m.mark_possible(db, 'synthetic-crash-attempt', 1))
            finally:
                if p.poll() is None:
                    p.kill()
                p.communicate(timeout=5)

    def test_kill_after_intent_commit(self):
        self.kill_at_checkpoint('intent')

    def test_kill_after_possible_commit(self):
        self.kill_at_checkpoint('possible')

    def test_no_opt_in_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'scratch.sqlite'
            p = subprocess.run([sys.executable, '-B', str(P), '--database', str(path),
                                '--checkpoint', 'intent'], timeout=5)
            self.assertEqual(p.returncode, 78)
            self.assertFalse(path.exists())

if __name__ == '__main__':
    unittest.main()
