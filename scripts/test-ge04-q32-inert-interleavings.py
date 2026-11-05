import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-inert-interleavings.py')
spec = importlib.util.spec_from_file_location('ge04_interleavings', P)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def test_all_five_event_orders(self):
        self.assertEqual(len(m.explore()), 120)
    def test_revoke_first_blocks_effect_start(self):
        s = m.model.transition(m.model.State(), 'revoke').state
        self.assertFalse(m.model.transition(s, 'effect_start', expected_revision=s.revision).accepted)
    def test_crash_after_start_requires_unknown_recovery(self):
        s = m.model.State()
        for action in ('claim', 'effect_start', 'crash'):
            s = m.model.transition(s, action).state
        self.assertEqual(s.phase, m.model.Phase.UNKNOWN_RECOVERY)
        self.assertFalse(m.model.transition(s, 'effect_confirm').accepted)
    def test_cli_hold(self):
        p = subprocess.run([sys.executable, '-B', str(P)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['synthetic_orderings'], 120)
        self.assertEqual(json.loads(p.stdout)['real_effects_performed'], 0)
if __name__ == '__main__':
    unittest.main()
