#!/usr/bin/env python3
"""Adversarial descriptor-bound installation fixture; no privilege required."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

spec = importlib.util.spec_from_file_location('ge04_installation', Path(__file__).with_name('signed-installation.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-install-') as temp:
    root = Path(temp)
    install = root / 'install'
    install.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    helper = b'GE04 signed helper fixture'
    manifest = json.dumps({'version': 1, 'release': 'fixture-1', 'platform': 'linux',
                           'helperSha256': hashlib.sha256(helper).hexdigest()}).encode()
    files = {'trusted.pub': signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw),
             'manifest.json': manifest, 'manifest.sig': signer.sign(manifest), 'helper': helper}
    for name, data in files.items():
        path = install / name
        path.write_bytes(data)
        path.chmod(0o400)
    uid = os.geteuid()
    pinned_key_digest = hashlib.sha256(files['trusted.pub']).hexdigest()
    assert module.verify_installation(install, uid, 'fixture-1', pinned_key_digest) == hashlib.sha256(helper).hexdigest()
    try:
        module.verify_installation(install, uid, 'fixture-1', '0' * 64)
        raise AssertionError('incorrect independent key pin accepted')
    except PermissionError:
        pass

    def denied():
        try:
            module.verify_installation(install, uid, 'fixture-1', pinned_key_digest)
        except (OSError, ValueError):
            return
        raise AssertionError('unsafe installation accepted')

    helper_path = install / 'helper'
    helper_path.chmod(0o600)
    denied()
    helper_path.chmod(0o400)
    signature_path = install / 'manifest.sig'
    signature_path.unlink()
    signature_path.symlink_to(root / 'other')
    denied()
    signature_path.unlink()
    signature_path.write_bytes(files['manifest.sig'])
    signature_path.chmod(0o400)
    install.chmod(0o777)
    denied()
    install.chmod(0o700)
    # A key+signature replacement must fail when the expected key digest is pinned outside the installation.
    attacker = Ed25519PrivateKey.generate()
    replacement = attacker.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    (install / 'trusted.pub').chmod(0o600)
    (install / 'trusted.pub').write_bytes(replacement)
    (install / 'trusted.pub').chmod(0o400)
    (install / 'manifest.sig').chmod(0o600)
    (install / 'manifest.sig').write_bytes(attacker.sign(manifest))
    (install / 'manifest.sig').chmod(0o400)
    denied()  # The independent pin must reject replacement of key and signature together.
    print('GE04 descriptor installation PASS: writable/symlink/dir denial; pinned key rejects same-UID key substitution')
