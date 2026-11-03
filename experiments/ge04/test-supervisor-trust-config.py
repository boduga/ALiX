#!/usr/bin/env python3
"""Standalone GE04 protected-config adversarial fixture, unprivileged mode."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

spec = importlib.util.spec_from_file_location('ge04_config', Path(__file__).with_name('supervisor-trust-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-trust-config-') as temp:
    root = Path(temp)
    install, config = root / 'install', root / 'config'
    install.mkdir(mode=0o700)
    config.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    helper = b'GE04 fixture'
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    manifest = json.dumps({'version': 1, 'release': 'fixture-1', 'platform': 'linux',
                           'helperSha256': hashlib.sha256(helper).hexdigest()}).encode()
    for name, content in {'trusted.pub': key, 'manifest.json': manifest,
                          'manifest.sig': signer.sign(manifest), 'helper': helper}.items():
        target = install / name
        target.write_bytes(content)
        target.chmod(0o400)
    pin = hashlib.sha256(key).hexdigest()
    trust = config / 'trust.json'
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': pin, 'release': 'fixture-1'}))
    trust.chmod(0o400)
    uid = os.geteuid()
    assert module.verify_from_trust_config(install, config, uid) == hashlib.sha256(helper).hexdigest()

    def denied():
        try:
            module.verify_from_trust_config(install, config, uid)
        except (PermissionError, OSError, ValueError):
            return
        raise AssertionError('unsafe trust config accepted')

    trust.chmod(0o600)
    denied()
    trust.chmod(0o400)
    config.chmod(0o777)
    denied()
    config.chmod(0o700)
    trust.unlink()
    trust.symlink_to(install / 'manifest.json')
    denied()
    trust.unlink()
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': pin, 'release': 'fixture-1'}))
    trust.chmod(0o400)
    attacker = Ed25519PrivateKey.generate()
    (install / 'trusted.pub').chmod(0o600)
    (install / 'trusted.pub').write_bytes(attacker.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    (install / 'trusted.pub').chmod(0o400)
    (install / 'manifest.sig').chmod(0o600)
    (install / 'manifest.sig').write_bytes(attacker.sign(manifest))
    (install / 'manifest.sig').chmod(0o400)
    denied()  # Replacing the release signing key does not replace independent config.
    print('GE04 supervisor trust config PASS: protected config and substituted release key denied')
