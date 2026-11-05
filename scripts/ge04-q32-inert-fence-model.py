#!/usr/bin/env python3
"""GE-04 synthetic, pure transition model. Never authorizes real effects."""
from dataclasses import dataclass, replace
from enum import Enum
import json

class Phase(str, Enum):
    UNCLAIMED = 'UNCLAIMED'
    CLAIMED = 'CLAIMED'
    EFFECT_POSSIBLE = 'EFFECT_POSSIBLE'
    EFFECT_CONFIRMED = 'EFFECT_CONFIRMED'
    ABORTED = 'ABORTED'
    UNKNOWN_RECOVERY = 'UNKNOWN_RECOVERY'

@dataclass(frozen=True)
class State:
    phase: Phase = Phase.UNCLAIMED
    revision: int = 1
    approval_live: bool = True
    attempt: str = 'attempt-1'
    nonce: str = 'synthetic-nonce'
    claimed: bool = False
    # This is a synthetic serialization clock, not an actual lock or durable store.
    fence: int = 0

@dataclass(frozen=True)
class Result:
    state: State
    accepted: bool
    disposition: str = 'HOLD'


def transition(state: State, action: str, *, expected_revision=1, attempt='attempt-1', nonce='synthetic-nonce') -> Result:
    """Immutable model: accepted means a simulated state transition, NEVER authority."""
    if action == 'revoke':
        if not state.approval_live:
            return Result(state, False)
        # Revocation is serialized against effect-start in this abstract model.
        return Result(replace(state, approval_live=False, revision=state.revision + 1, fence=state.fence + 1), True)
    if action == 'crash':
        if state.phase == Phase.EFFECT_POSSIBLE:
            return Result(replace(state, phase=Phase.UNKNOWN_RECOVERY), True)
        if state.phase == Phase.CLAIMED:
            return Result(replace(state, phase=Phase.ABORTED), True)
        return Result(state, False)
    if action == 'abort':
        if state.phase in (Phase.UNCLAIMED, Phase.CLAIMED):
            return Result(replace(state, phase=Phase.ABORTED), True)
        return Result(state, False)
    if not state.approval_live or expected_revision != state.revision or attempt != state.attempt or nonce != state.nonce:
        return Result(state, False)
    if action == 'claim' and state.phase == Phase.UNCLAIMED and not state.claimed:
        return Result(replace(state, phase=Phase.CLAIMED, claimed=True), True)
    if action == 'effect_start' and state.phase == Phase.CLAIMED:
        # A linearized synthetic boundary; NO I/O or external effect occurs.
        return Result(replace(state, phase=Phase.EFFECT_POSSIBLE, fence=state.fence + 1), True)
    if action == 'effect_confirm' and state.phase == Phase.EFFECT_POSSIBLE:
        return Result(replace(state, phase=Phase.EFFECT_CONFIRMED), True)
    return Result(state, False)


def main():
    s = State()
    for action in ('claim', 'effect_start', 'crash', 'effect_confirm'):
        result = transition(s, action)
        s = result.state
    print(json.dumps({'gate': 'GE04_Q32_INERT_FENCE', 'disposition': 'HOLD',
                      'phase': s.phase.value, 'qualified_effect_authority': False,
                      'real_effects_performed': 0}, sort_keys=True))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
