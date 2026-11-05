#!/usr/bin/env python3
"""GE-04 final-boundary PROTOCOL MODEL ONLY: no filesystem mutation or grant.

A logical deterministic state machine to test ordering constraints before a
privileged native backend may be designed. Do not use as authorization.
"""
from dataclasses import dataclass
from enum import Enum, auto
from hashlib import sha256


class Phase(Enum):
    IDLE = auto()
    PREPARED_UNVERIFIED = auto()
    OBSERVED_UNVERIFIED = auto()
    QUARANTINED = auto()


@dataclass(frozen=True)
class Request:
    attempt: str
    approval: str
    lease: str
    policy_revision: int
    operation_digest: str
    scope: str
    worker: str


class InertBoundaryModel:
    """Serialized event-order model; NEVER emits a real execution grant."""

    def __init__(self):
        self.approval = 'approved-id'
        self.lease = 'lease-id'
        self.worker = 'worker-id'
        self.scope = 'owned'
        self.revision = 7
        self.expires_at = 1000
        self.revoked = False
        self.consumed = set()
        self.approval_consumed = False
        self.phase = Phase.IDLE
        self.prepared = None
        self.receipts = []
        self.event_log = []

    def revoke(self, revision):
        if type(revision) is not int or revision <= self.revision:
            raise ValueError('revision must increase')
        if self.phase in (Phase.PREPARED_UNVERIFIED, Phase.OBSERVED_UNVERIFIED):
            # A real supervisor cannot publish revocation until the lock
            # excludes the kernel effect. Model refuses instead of faking it.
            return 'WAIT_FOR_TERMINAL_OR_UNKNOWN'
        self.revision = revision
        self.revoked = True
        self.event_log.append('REVOCATION_LINEARIZED')
        return 'REVOKED_UNVERIFIED'

    def prepare(self, request, now):
        """Final lock-entry decision, not pre-spawn coordinator permission."""
        if self.phase != Phase.IDLE or type(now) is not int or now < 0:
            return 'DENIED'
        if (not isinstance(request, Request) or self.revoked or self.approval_consumed or
                request.approval != self.approval or request.lease != self.lease or
                request.worker != self.worker or request.scope != self.scope or
                request.policy_revision != self.revision or now >= self.expires_at or
                not request.attempt or request.attempt in self.consumed or
                not request.operation_digest or len(request.operation_digest) != 64 or
                any(c not in '0123456789abcdef' for c in request.operation_digest)):
            return 'DENIED'
        self.consumed.add(request.attempt)
        self.approval_consumed = True
        self.prepared = request
        self.phase = Phase.PREPARED_UNVERIFIED
        self.event_log.append('PREPARE_DURABLE_BEFORE_EFFECT')
        return 'INERT_PREPARED_UNVERIFIED'

    def observe_inert_effect(self, request, actual_digest, pinned_scope):
        """Models a kernel callback, never invokes an actual syscall."""
        if (self.phase != Phase.PREPARED_UNVERIFIED or request != self.prepared or
                actual_digest != request.operation_digest or
                pinned_scope != request.scope):
            return 'DENIED'
        self.event_log.append('INERT_BOUNDARY_OBSERVED')
        self.phase = Phase.OBSERVED_UNVERIFIED
        return 'INERT_EFFECT_OBSERVED_UNVERIFIED'

    def settle(self, request):
        if self.phase != Phase.OBSERVED_UNVERIFIED or request != self.prepared:
            return 'UNCERTAIN'
        self.receipts.append((request.attempt, 'INERT_EFFECT_UNVERIFIED'))
        self.event_log.append('INERT_RECEIPT_RECORDED')
        self.phase = Phase.IDLE
        self.prepared = None
        return 'INERT_TERMINAL_UNVERIFIED'

    def crash(self):
        if self.phase in (Phase.PREPARED_UNVERIFIED, Phase.OBSERVED_UNVERIFIED):
            self.phase = Phase.QUARANTINED
            self.event_log.append('UNKNOWN_AFTER_CRASH')
        return 'UNCERTAIN'

    def recover(self, request):
        if request.attempt in self.consumed:
            return 'UNCERTAIN_NO_REPLAY'
        return 'NO_OUTCOME_EVIDENCE'


def sample_request():
    return Request('attempt-1', 'approved-id', 'lease-id', 7,
                   sha256(b'fixed-inert-operation').hexdigest(), 'owned', 'worker-id')
