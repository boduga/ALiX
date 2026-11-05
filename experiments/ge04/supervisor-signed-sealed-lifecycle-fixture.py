#!/usr/bin/env python3
"""GE-04 signed-release-sequence -> sealed image -> composed fixed operation.

ROOT-ONLY disposable fixture. No production admission or trusted service identity.
Caller-selected config/release/floor paths are NOT trusted supervisor provisioning.
"""
import importlib.util
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_signed_composed_' + name.replace('-', '_'), BASE / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


prepare = load('trusted-supervisor-preparation')
composed = load('supervisor-composed-lifecycle-fixture')


def run_signed_sealed_fixture(private, public, owned, anchor_dir,
                              pinned_receipt_key_digest,
                              config, release, floor, evidence, *,
                              now_ms, effect_now_ms, crash_checkpoint=None):
    """No caller-provided helper digest, bytes, receipt or terminal claim.

    Signed manifest bytes and release sequence come from existing pinned
    verifier, and are rehashed after sealing before approval consumption.
    Return value remains UNVERIFIED; caller paths are fixture-controlled.
    """
    if os.geteuid() != 0:
        raise PermissionError('Linux root test fixture required')
    fd, digest, sequence = prepare.prepare(
        Path(config), Path(release), Path(floor), Path(evidence), owner_uid=0)
    try:
        if type(sequence) is not int or sequence < 1:
            raise PermissionError('signed release sequence unavailable')
        return composed.run_fixed_fixture(
            private, public, owned, pinned_receipt_key_digest,
            None, anchor_dir=anchor_dir, expected_binary_digest=digest,
            now_ms=now_ms, effect_now_ms=effect_now_ms,
            crash_checkpoint=crash_checkpoint, sealed_native_fd=fd)
    finally:
        os.close(fd)
