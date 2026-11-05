#!/usr/bin/env python3
"""GE-04 root-only signed-observation custody and adversarial verification."""
import hashlib
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('requires Linux root for distinct-UID custody test')

spec = importlib.util.spec_from_file_location(
    'ge04_signed_native', Path(__file__).with_name('signed-native-observation-fixture.py'))
signed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signed)

def dropped():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)

with tempfile.TemporaryDirectory(prefix='ge04-signed-native-') as folder:
    root = Path(folder)
    root.chmod(0o755)
    private = root / 'root-custody'
    private.mkdir(mode=0o700)
    public = root / 'public-observations'
    public.mkdir(mode=0o755)
    pin = signed.provision(private, public)
    observed = b'fixed test-only kernel observation; not authentic operation evidence'
    body = b'GE04_INERT_KERNEL_WRITE_NO_PRODUCTION_AUTHORITY\n'
    digest = hashlib.sha256(body).hexdigest()
    obs_digest = hashlib.sha256(observed).hexdigest()
    state = {'approvalState': 'consumed', 'inFlight': None,
             'consumed': ['fixed-kernel-attempt'], 'approvalId': 'approval',
             'leaseId': 'lease', 'policyRevision': 7, 'revoked': False}
    def denied(fn):
        try:
            fn()
        except (PermissionError, FileExistsError):
            return
        raise AssertionError('invalid receipt creation accepted')
    denied(lambda: signed.sign_observation(private, public, {**state, 'inFlight': 'fixed-kernel-attempt'},
                                           observed, digest, pin))
    assert signed.sign_observation(private, public, state, observed, digest, pin) == (
        'GE04_SIGNED_FIXTURE_OBSERVATION_PERSISTED_UNVERIFIED')
    denied(lambda: signed.sign_observation(private, public, state, observed, digest, pin))
    assert signed.verify_observation(public, pin, obs_digest, digest) == (
        'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED')
    assert signed.verify_observation(public, '0' * 64, obs_digest, digest) == 'UNCERTAIN_NO_REPLAY'
    assert signed.verify_observation(public, pin, '0' * 64, digest) == 'UNCERTAIN_NO_REPLAY'
    assert signed.verify_observation(public, pin, obs_digest, '0' * 64) == 'UNCERTAIN_NO_REPLAY'

    # An untrusted, separately executed coordinator cannot read/replace the
    # signer secret or mint a new signed receipt, but can verify public evidence.
    # Runner checkouts can have non-traversable parents for UID 65534;
    # publish only the verifier source, never a private signing credential.
    verifier_source = public / 'public-verifier.py'
    shutil.copyfile(Path(__file__).with_name('signed-native-observation-fixture.py'),
                    verifier_source)
    verifier_source.chmod(0o644)
    script = """
import importlib.util, os, pathlib, sys
directory, public, module_path, pin, obs, effect = sys.argv[1:]
assert os.geteuid() == 65534
spec = importlib.util.spec_from_file_location('ge04_verify_child', module_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
for action in (
    lambda: (pathlib.Path(directory) / mod.PRIVATE).read_bytes(),
    lambda: (pathlib.Path(directory) / mod.PRIVATE).write_bytes(b'bad'),
    lambda: (pathlib.Path(public) / mod.RECEIPT).write_text('forged'),
    lambda: (pathlib.Path(public) / mod.PUBLIC).write_text('fake key'),
):
    try:
        action()
    except PermissionError:
        continue
    raise AssertionError('untrusted user accessed signer custody')
assert mod.verify_observation(public, pin, obs, effect) == 'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED'
print('GE04_COORDINATOR_PUBLIC_VERIFICATION_PASS')
"""
    child = subprocess.run(
        [sys.executable, '-B', '-c', script, str(private), str(public),
         str(verifier_source),
         pin, obs_digest, digest],
        preexec_fn=dropped, capture_output=True, text=True, timeout=10)
    assert child.returncode == 0, (child.stdout, child.stderr)
    assert 'GE04_COORDINATOR_PUBLIC_VERIFICATION_PASS' in child.stdout

    receipt = public / signed.RECEIPT
    original = receipt.read_bytes()
    parsed = json.loads(original)
    parsed['payload']['status'] = 'NATIVE_PRODUCTION_SUCCESS'
    receipt.write_bytes(signed.canonical(parsed) + b'\n')
    assert signed.verify_observation(public, pin, obs_digest, digest) == 'UNCERTAIN_NO_REPLAY'
    receipt.write_bytes(original)
    parsed = json.loads(original)
    parsed['signature'] = '00' * 64
    receipt.write_bytes(signed.canonical(parsed) + b'\n')
    assert signed.verify_observation(public, pin, obs_digest, digest) == 'UNCERTAIN_NO_REPLAY'
    receipt.write_bytes(original)
    assert signed.verify_observation(public, pin, obs_digest, digest).endswith('_UNVERIFIED')

    # Explicit RELEASE BLOCKER: a compromised root fixture owner can sign
    # invented input bytes without running any kernel mutation. A public
    # signature alone does not prove effect provenance.
    fake_private = root / 'fabricated-root'
    fake_private.mkdir(mode=0o700)
    fake_public = root / 'fabricated-public'
    fake_public.mkdir(mode=0o755)
    fake_pin = signed.provision(fake_private, fake_public)
    assert signed.sign_observation(fake_private, fake_public, state,
                                   b'FABRICATED_NO_KERNEL_EFFECT', digest,
                                   fake_pin).endswith('_UNVERIFIED')
    assert signed.verify_observation(fake_public, fake_pin,
                                     hashlib.sha256(b'FABRICATED_NO_KERNEL_EFFECT').hexdigest(),
                                     digest).endswith('_UNVERIFIED')
    print('GE04 ROOT_FIXTURE_FORGERY_REPRODUCED_UNVERIFIED')

print('GE04 signed fixture custody PASS: distinct UID denied; public signature verified; forgery, binding mismatch, replay denied')
