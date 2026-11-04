#!/usr/bin/env python3
"""Negative and positive sealed-copy checks for a signed installation.

No helper execution, production trust root, or authorization occurs here.
"""
import fcntl
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

with tempfile.TemporaryDirectory(prefix='ge04-signed-sealed-') as tmp:
    installation = Path(tmp) / 'installation'
    installation.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    helper = b'GE04 signed release fixture version one'
    manifest = json.dumps({
        'version': 1, 'release': 'release-1', 'platform': 'linux',
        'helperSha256': hashlib.sha256(helper).hexdigest()
    }).encode()
    files = {
        'trusted.pub': signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw),
        'manifest.json': manifest,
        'manifest.sig': signer.sign(manifest),
        'helper': helper,
    }
    for name, data in files.items():
        path = installation / name
        path.write_bytes(data)
        path.chmod(0o400)
    pin = hashlib.sha256(files['trusted.pub']).hexdigest()
    expected = hashlib.sha256(helper).hexdigest()
    uid = os.geteuid()

    # Wrong key pin, release or signed helper must fail before any snapshot is returned.
    for bad_pin, bad_release in [('0' * 64, 'release-1'), (pin, 'release-2')]:
        try:
            module.prepare_verified_sealed_helper(installation, uid, bad_release, bad_pin)
        except PermissionError:
            pass
        else:
            raise AssertionError('untrusted release generated an executable snapshot')

    sealed_fd, digest = module.prepare_verified_sealed_helper(installation, uid, 'release-1', pin)
    try:
        assert digest == expected
        required = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        assert fcntl.fcntl(sealed_fd, fcntl.F_GET_SEALS) & required == required
        for operation in (lambda: os.pwrite(sealed_fd, b'X', 0),
                          lambda: os.ftruncate(sealed_fd, 1)):
            try:
                operation()
            except OSError:
                pass
            else:
                raise AssertionError('sealed signed bytes were mutated')

        original_inode = (installation / 'helper').stat().st_ino
        (installation / 'helper').chmod(0o600)
        (installation / 'helper').write_bytes(b'attacker modified bytes')
        (installation / 'helper').chmod(0o400)
        assert (installation / 'helper').stat().st_ino == original_inode
        assert hashlib.sha256((installation / 'helper').read_bytes()).hexdigest() != expected
        os.lseek(sealed_fd, 0, os.SEEK_SET)
        assert hashlib.sha256(os.read(sealed_fd, len(helper) + 1)).hexdigest() == expected
        # Rechecking the changed installation must now reject it.
        try:
            module.prepare_verified_sealed_helper(installation, uid, 'release-1', pin)
        except PermissionError:
            pass
        else:
            raise AssertionError('modified helper generated a new sealed snapshot')
    finally:
        os.close(sealed_fd)
    print('GE04 signed-to-sealed snapshot PASS: signed bytes immutable after source tamper; negatives denied')
