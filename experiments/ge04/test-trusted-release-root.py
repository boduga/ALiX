#!/usr/bin/env python3
"""Privileged CI test for descriptor-only GE04 verification; no execution."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 trusted release test REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_trusted_release', Path(__file__).with_name('trusted-release-verification.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-trusted-release-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    config, release = root / 'config', root / 'release'
    config.mkdir(mode=0o700)
    release.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    helper = b'GE04 isolated fixture'
    manifest = json.dumps({'version': 1, 'release': 'fixture-1', 'platform': 'linux', 'helperSha256': hashlib.sha256(helper).hexdigest()}).encode()
    files = {'trusted.pub': key, 'manifest.json': manifest, 'manifest.sig': signer.sign(manifest), 'helper': helper}
    for name, data in files.items():
        path = release / name
        path.write_bytes(data)
        path.chmod(0o400)
    trust = config / 'trust.json'
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': hashlib.sha256(key).hexdigest(), 'release': 'fixture-1'}))
    trust.chmod(0o400)
    assert module.verify(config, release, 0) == hashlib.sha256(helper).hexdigest()
    release.chmod(0o777)
    try:
        module.verify(config, release, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('writable release directory accepted')
    release.chmod(0o700)
    link = root / 'linked-config'
    link.symlink_to(config, target_is_directory=True)
    try:
        module.verify(link, release, 0)
    except OSError:
        pass
    else:
        raise AssertionError('symlink config accepted')
print('GE04 trusted release descriptor PASS: verified signed bytes; unsafe ancestry and symlink denied')
