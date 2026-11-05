#!/usr/bin/env python3
"""Exhaustive small synthetic interleavings; never invokes effects or issues authority."""
import importlib.util
import itertools
import json
from pathlib import Path

SOURCE = Path(__file__).with_name('ge04-q32-inert-fence-model.py')
spec = importlib.util.spec_from_file_location('ge04_inert_model', SOURCE)
model = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = model
spec.loader.exec_module(model)

# Each permutation represents a total ordering of atomic *model* transitions.
# It does not simulate threads, durability, or a real effect.
ACTIONS = ('claim', 'effect_start', 'revoke', 'crash', 'effect_confirm')

def explore():
    cases = []
    for ordering in itertools.permutations(ACTIONS):
        state = model.State()
        events = []
        for action in ordering:
            before = state
            outcome = model.transition(state, action, expected_revision=state.revision)
            state = outcome.state
            events.append((action, outcome.accepted, before.phase.value, state.phase.value))
            if action == 'effect_start' and outcome.accepted and not before.approval_live:
                raise AssertionError('effect started after revocation')
            if before.phase == model.Phase.UNKNOWN_RECOVERY and outcome.accepted and action in ('claim', 'effect_start', 'effect_confirm'):
                raise AssertionError('ambiguous effect was retried or confirmed')
        cases.append((ordering, events, state))
    return cases

def main():
    cases = explore()
    print(json.dumps({'gate': 'GE04_Q32_INERT_INTERLEAVINGS', 'disposition': 'HOLD',
                      'synthetic_orderings': len(cases), 'real_effects_performed': 0,
                      'concurrency_or_durability_qualified': False}, sort_keys=True))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
