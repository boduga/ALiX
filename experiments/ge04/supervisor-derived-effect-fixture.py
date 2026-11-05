#!/usr/bin/env python3
"""GE-04 supervisor-derived signing gate — ROOT-ONLY EXPERIMENT, NOT PRODUCTION.

No caller-supplied effect bytes, observation bytes, digest, or success claim.
Derive signed fields from an already-settled root-owned authority state,
a durable MAC observation, and a pinned directory FD under the same lock.
The root fixture still controls keys/journal and can forge all three.
"""
import hashlib
import importlib.util
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_derived_' + name.replace('-', '_'), BASE / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


authority = load('sup25-atomic-authority-fixture')
observed = load('native-effect-observation-fixture')
signed = load('signed-native-observation-fixture')


def _inspect_locked(authority_fd, private, pinned_fd, state):
    if (state['approvalState'] != 'consumed' or
            state['inFlight'] is not None or
            state['consumed'] != [observed.ATTEMPT] or
            state['approvalId'] != 'approval' or state['leaseId'] != 'lease' or
            state['policyRevision'] != 7 or state['revoked']):
        raise PermissionError('unsettled, stale, or revoked fixture authority')
    if observed.classify_locked(authority_fd, private, pinned_fd, state) != (
            'GE04_NATIVE_EFFECT_OBSERVATION_MATCHED_UNVERIFIED'):
        raise PermissionError('no matching protected effect observation')
    handle = os.open(observed.NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                     dir_fd=authority_fd)
    try:
        raw = os.read(handle, 2049)
        if not raw or len(raw) > 2048:
            raise PermissionError('unbounded observation')
    finally:
        os.close(handle)
    effect = observed._exact_file(pinned_fd)
    return hashlib.sha256(raw).hexdigest(), effect['bodySha256'], raw


def publish(private, pinned_dir, public, pinned_key_digest):
    """Create once from supervisor-observed state; no request-provided bytes."""
    if os.geteuid() != 0:
        raise PermissionError('privileged supervisor fixture required')
    authority_fd = authority._directory(private)
    try:
        lock = authority._lock(authority_fd)
        try:
            state = authority._load(authority_fd)
            pinned_fd = os.open(pinned_dir, os.O_RDONLY | os.O_DIRECTORY |
                                os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                _digest, effect_digest, raw = _inspect_locked(
                    authority_fd, private, pinned_fd, state)
                return signed.sign_observation(
                    private, public, state, raw, effect_digest, pinned_key_digest)
            finally:
                os.close(pinned_fd)
        finally:
            os.close(lock)
    finally:
        os.close(authority_fd)


def recover_read_only(private, pinned_dir, public, pinned_key_digest):
    """Fail closed on any gap. This never changes authority or retries an effect."""
    try:
        if os.geteuid() != 0:
            return 'UNCERTAIN_NO_REPLAY'
        authority_fd = authority._directory(private)
        try:
            lock = authority._lock(authority_fd)
            try:
                state = authority._load(authority_fd)
                pinned_fd = os.open(pinned_dir, os.O_RDONLY | os.O_DIRECTORY |
                                    os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    observation_digest, effect_digest, _raw = _inspect_locked(
                        authority_fd, private, pinned_fd, state)
                    return signed.verify_observation(
                        public, pinned_key_digest, observation_digest, effect_digest)
                finally:
                    os.close(pinned_fd)
            finally:
                os.close(lock)
        finally:
            os.close(authority_fd)
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        return 'UNCERTAIN_NO_REPLAY'
