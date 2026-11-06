import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-deny-envelope.py')
spec = importlib.util.spec_from_file_location('deny_envelope', P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
GOOD = {k: 'synthetic-' + k for k in m.FIELDS}
GOOD.update(protocol_version='synthetic-v1', audience='supervisor')

class Tests(unittest.TestCase):
    def assertDenied(self, payload, expected=GOOD, seen=None, reason=None):
        result = m.inspect(payload, expected, seen)
        self.assertFalse(result['authorized'])
        self.assertEqual(result['disposition'], 'HOLD')
        self.assertEqual(result['real_effects_performed'], 0)
        if reason: self.assertEqual(result['reason'], reason)
    def test_complete_is_still_denied(self):
        self.assertDenied(GOOD, reason='DENIED_SECURITY_HOLD')
    def test_malformed(self):
        for value in (None, [], 'approved', {'approved': True}):
            with self.subTest(value=value): self.assertDenied(value)
    def test_missing_and_extra(self):
        for k in m.FIELDS:
            with self.subTest(field=k):
                self.assertDenied({x:v for x,v in GOOD.items() if x!=k}, reason='INVALID_BINDING')
        self.assertDenied({**GOOD, 'approved':True}, reason='INVALID_BINDING')
    def test_altered_binding_each_field(self):
        for k in m.FIELDS:
            with self.subTest(field=k):
                changed = {**GOOD, k:'altered'}
                self.assertDenied(changed, reason=('WRONG_PROTOCOL_OR_AUDIENCE' if k in ('protocol_version','audience') else 'BINDING_MISMATCH'))
    def test_replay_and_cross_attempt(self):
        key = (GOOD['issuer'], GOOD['attempt'], GOOD['generation'], GOOD['nonce'])
        self.assertDenied(GOOD, seen={key}, reason='REPLAY_OBSERVED')
        self.assertDenied({**GOOD,'attempt':'other'}, reason='BINDING_MISMATCH')
    def test_invalid_expectation(self):
        self.assertDenied(GOOD, expected={}, reason='INVALID_EXPECTATION')
    def test_cli_fail_closed(self):
        for opts in ([], ['--isolated-test']):
            p=subprocess.run([sys.executable,'-B',str(P),*opts],capture_output=True,text=True)
            self.assertEqual(p.returncode,78)
            self.assertFalse(json.loads(p.stdout)['authorized'])
if __name__=='__main__': unittest.main()
