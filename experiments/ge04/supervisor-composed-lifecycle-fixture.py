#!/usr/bin/env python3
"""GE-04 fixed native fixture lifecycle. EXPERIMENT ONLY; not trusted receipts.

Composition closes a test sequencing gap, not the root/same-UID security
boundary. The lower-level signer and test binary remain root-controlled.
Never register this module with the production mutation service.
"""
import importlib.util
import os
from pathlib import Path
import subprocess

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_composed_' + name.replace('-', '_'), BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


authority = load('sup25-atomic-authority-fixture')
observed = load('native-effect-observation-fixture')
derived = load('supervisor-derived-effect-fixture')
signed = load('signed-native-observation-fixture')
journal = load('supervisor-lifecycle-journal')

# Non-public test harness injection only.
CHECKPOINTS = frozenset({'after_prepare', 'after_native', 'after_observation',
                         'after_settlement', 'after_signature'})


def run_fixed_fixture(private, public, owned, pinned_key_digest, binary, *,
                      now_ms, crash_checkpoint=None):
    """One fixed test effect, with consumed approval under one lock.

    No caller observation, effect digest, status, or success flag accepted.
    The binary is test-harness controlled and NOT a trusted loader.
    """
    if os.geteuid() != 0:
        raise PermissionError('privileged experimental supervisor fixture only')
    if type(now_ms) is not int or now_ms < 0:
        raise ValueError('invalid clock fixture')
    if crash_checkpoint is not None and crash_checkpoint not in CHECKPOINTS:
        raise ValueError('unknown test crash checkpoint')
    fd = authority._directory(private)
    try:
        lock = authority._lock(fd)
        try:
            state = authority._load(fd)
            if (state['revoked'] or state['approvalState'] != 'approved' or
                    state['approvalId'] != 'approval' or state['leaseId'] != 'lease' or
                    state['policyRevision'] != 7 or state['inFlight'] is not None or
                    state['consumed'] or now_ms >= state['expiresAtMs']):
                raise PermissionError('fixture admission denied')
            pinned = os.open(owned, os.O_RDONLY | os.O_DIRECTORY |
                             os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                request_digest = journal.fingerprint(journal.fixed_request(state, pinned))
                if journal.read_chain(fd, request_digest)[0]:
                    raise PermissionError('prior journal attempt exists')
                state['approvalState'] = 'consumed'
                state['inFlight'] = observed.ATTEMPT
                state['consumed'] = [observed.ATTEMPT]
                authority._save(fd, state)
                journal.append(fd, request_digest, 'PREPARED')
                _crash(crash_checkpoint, 'after_prepare')

                # Fixed disposable native experiment; not trusted binary origin.
                result = subprocess.run(
                    [os.fspath(binary), 'GE04-INERT-FIXTURE-V1', str(pinned)],
                    pass_fds=(pinned,), close_fds=True,
                    env={'PATH': '/usr/bin:/bin'}, capture_output=True,
                    text=True, timeout=8, check=False)
                if result.returncode != 0 or result.stdout.strip() != observed.MARKER:
                    raise PermissionError('native fixture did not produce required marker')
                _crash(crash_checkpoint, 'after_native')
                observed.persist_locked(fd, private, pinned, state, result.stdout.strip())
                journal.append(fd, request_digest, 'OBSERVED')
                _crash(crash_checkpoint, 'after_observation')

                state['inFlight'] = None
                authority._save(fd, state)
                journal.append(fd, request_digest, 'SETTLED')
                _crash(crash_checkpoint, 'after_settlement')

                # Do not re-enter derived.publish's flock while already locked.
                _obs_hash, effect_hash, observation_bytes = derived._inspect_locked(
                    fd, private, pinned, state)
                marker = signed.sign_observation(
                    private, public, state, observation_bytes,
                    effect_hash, pinned_key_digest)
                journal.append(fd, request_digest, 'SIGNED')
                _crash(crash_checkpoint, 'after_signature')
                if not marker.endswith('_UNVERIFIED'):
                    raise PermissionError('unexpected fixture signing marker')
                return 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
            finally:
                os.close(pinned)
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def _crash(configured, stage):
    if configured == stage:
        os._exit(88)


def recover_read_only(private, owned, public, pinned_key_digest):
    """Only inspect; incomplete or contradictory evidence means no replay."""
    try:
        if os.geteuid() != 0:
            return 'UNCERTAIN_NO_REPLAY'
        fd = authority._directory(private)
        try:
            lock = authority._lock(fd)
            try:
                state = authority._load(fd)
                if (state['approvalState'] != 'consumed' or
                        state['inFlight'] is not None or
                        state['consumed'] != [observed.ATTEMPT] or
                        state['revoked']):
                    return 'UNCERTAIN_NO_REPLAY'
                pinned = os.open(owned, os.O_RDONLY | os.O_DIRECTORY |
                                 os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    request_digest = journal.fingerprint(
                        journal.fixed_request(state, pinned))
                    if journal.classify(fd, request_digest) != 'CHAIN_COMPLETE_UNVERIFIED':
                        return 'UNCERTAIN_NO_REPLAY'
                    obs_hash, effect_hash, _raw = derived._inspect_locked(
                        fd, private, pinned, state)
                    return signed.verify_observation(
                        public, pinned_key_digest, obs_hash, effect_hash)
                finally:
                    os.close(pinned)
            finally:
                os.close(lock)
        finally:
            os.close(fd)
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        return 'UNCERTAIN_NO_REPLAY'
