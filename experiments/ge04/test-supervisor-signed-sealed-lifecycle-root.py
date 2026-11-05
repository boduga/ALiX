#!/usr/bin/env python3
"""Root-only signed v2 release -> sealed native fixture -> lifecycle regression."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 signed sealed lifecycle requires Linux root')

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_signed_sealed_test_' + name.replace('-', '_'), BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner = load('supervisor-signed-sealed-lifecycle-fixture')
credential = load('fixture-credential-provisioning')
authority = load('sup25-atomic-authority-fixture')
signed_receipt = load('signed-native-observation-fixture')
composed = load('supervisor-composed-lifecycle-fixture')
observed = load('native-effect-observation-fixture')
UNKNOWN = 'UNCERTAIN_NO_REPLAY'
MATCH = 'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED'

with tempfile.TemporaryDirectory(prefix='ge04-signed-sealed-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    binary = root / 'native-test'
    build = subprocess.run(
        ['gcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
         str(BASE / 'final-boundary-inert-kernel-create.c'), '-o', str(binary)],
        capture_output=True, text=True, timeout=20)
    assert build.returncode == 0, build.stderr
    helper = binary.read_bytes()
    digest = hashlib.sha256(helper).hexdigest()

    config, release, floor, evidence = (
        root / name for name in ('config', 'release', 'floor', 'evidence'))
    for directory in (config, release, floor, evidence):
        directory.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    def store(directory, filename, value):
        path = directory / filename
        if path.exists():
            path.chmod(0o600)
        path.write_bytes(value)
        path.chmod(0o400)

    store(config, 'trust.json', json.dumps({
        'version': 1, 'trustedKeySha256': hashlib.sha256(key).hexdigest(),
        'release': 'ge04-fixed-native-v2'}).encode())
    store(floor, 'floor.json', json.dumps({
        'version': 1, 'minimumSequence': 12}).encode())
    store(release, 'trusted.pub', key)
    store(release, 'helper', helper)

    def publish(sequence=12, signing=signer, body_digest=digest):
        manifest = json.dumps({
            'version': 2, 'release': 'ge04-fixed-native-v2',
            'platform': 'linux', 'helperSha256': body_digest,
            'sequence': sequence}).encode()
        store(release, 'manifest.json', manifest)
        store(release, 'manifest.sig', signing.sign(manifest))

    publish()

    def case(label):
        private, public, owned, anchor = (
            root / (label + suffix) for suffix in
            ('-private', '-public', '-owned', '-anchor'))
        private.mkdir(mode=0o700)
        public.mkdir(mode=0o755)
        owned.mkdir(mode=0o700)
        anchor.mkdir(mode=0o700)
        credential.install_fixture_key(private)
        authority.initialize(
            private, revision=7, lease='lease', expiry=1000, approval='approval')
        pin = signed_receipt.provision(private, public)
        return private, public, owned, anchor, pin

    def execute(item):
        private, public, owned, anchor, pin = item
        return runner.run_signed_sealed_fixture(
            private, public, owned, anchor, pin,
            config, release, floor, evidence,
            now_ms=1, effect_now_ms=1)

    good = case('good')
    assert execute(good) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(
        good[0], good[2], good[1], good[4],
        anchor_dir=good[3]) == MATCH
    assert (good[2] / observed.LEAF).read_bytes() == observed.BODY
    try:
        execute(good)
    except PermissionError:
        pass
    else:
        raise AssertionError('signed fixture approval replay accepted')

    def deny_without_consumption(item):
        try:
            execute(item)
        except (PermissionError, ValueError, InvalidSignature):
            pass
        else:
            raise AssertionError('untrusted release executed')
        assert authority.inspect(item[0])['approvalState'] == 'approved'
        assert not (item[2] / observed.LEAF).exists()

    # Even correctly signed v2 releases cannot cross a higher floor.
    publish(sequence=11)
    deny_without_consumption(case('rollback'))
    # Wrong signer is not accepted with the independently pinned test key.
    publish(sequence=12, signing=Ed25519PrivateKey.generate())
    deny_without_consumption(case('wrong-signing-key'))
    publish()
    # A changed helper is denied by the release hash before approval spend.
    store(release, 'helper', helper + b'X')
    deny_without_consumption(case('modified-helper'))
    store(release, 'helper', helper)
    # Fail closed when the protected release trust configuration is damaged.
    store(config, 'trust.json', b'{"version":1,"release":"attacker"}')
    deny_without_consumption(case('untrusted-config'))

print('GE04 signed sealed lifecycle PASS: signed sequence, immutable native execution, denial before approval, no replay; HOLD')
