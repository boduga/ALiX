import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-inert-fence-model.py')
spec = importlib.util.spec_from_file_location('inert_fence', P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def test_single_use_and_attempt_binding(self):
        s = m.State()
        self.assertFalse(m.transition(s, 'claim', attempt='wrong').accepted)
        self.assertFalse(m.transition(s, 'claim', nonce='wrong').accepted)
        s = m.transition(s, 'claim').state
        self.assertFalse(m.transition(s, 'claim').accepted)
        self.assertTrue(s.claimed)
    def test_revocation_before_effect_denies(self):
        s = m.transition(m.State(), 'claim').state
        s = m.transition(s, 'revoke').state
        self.assertFalse(m.transition(s, 'effect_start', expected_revision=2).accepted)
        self.assertEqual(s.revision, 2)
    def test_effect_before_revoke_is_ordered(self):
        s = m.transition(m.State(), 'claim').state
        s = m.transition(s, 'effect_start').state
        self.assertEqual(s.phase, m.Phase.EFFECT_POSSIBLE)
        s = m.transition(s, 'revoke').state
        self.assertFalse(m.transition(s, 'effect_confirm', expected_revision=2).accepted)
    def test_crash_after_start_ambiguous_no_replay(self):
        s = m.transition(m.State(), 'claim').state
        s = m.transition(s, 'effect_start').state
        s = m.transition(s, 'crash').state
        self.assertEqual(s.phase, m.Phase.UNKNOWN_RECOVERY)
        self.assertFalse(m.transition(s, 'claim').accepted)
        self.assertFalse(m.transition(s, 'effect_start').accepted)
    def test_crash_before_start_aborted(self):
        s = m.transition(m.State(), 'claim').state
        s = m.transition(s, 'crash').state
        self.assertEqual(s.phase, m.Phase.ABORTED)
        self.assertFalse(m.transition(s, 'claim').accepted)
    def test_racing_claims_only_one(self):
        s = m.State()
        winners = 0
        for _ in range(10):
            r = m.transition(s, 'claim')
            winners += r.accepted
            s = r.state
        self.assertEqual(winners, 1)
    def test_stale_revision(self):
        self.assertFalse(m.transition(m.State(), 'claim', expected_revision=2).accepted)
    def test_cli_always_hold(self):
        p = subprocess.run([sys.executable, '-B', str(P)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['real_effects_performed'], 0)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')

if __name__ == '__main__':
    unittest.main()
