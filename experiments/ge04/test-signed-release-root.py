#!/usr/bin/env python3
"""Root-gated signed release installation DAC test. Never elevates itself."""
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
    raise SystemExit('GE04 signed installation test REQUIRES root (not a pass)')

spec = importlib.util.spec_from_file_location('ge04_signed_release', Path(__file__).with_name('signed-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-signed-root-') as temp:
    root = Path(temp)
    root.chmod(0o755)
    install = root / 'install'
    install.mkdir(mode=0o755)
    signer = Ed25519PrivateKey.generate()  # Ephemeral CI fixture, NOT a release key.
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    helper = b'GE04 fixture helper'
    manifest = json.dumps({'version': 1, 'release': 'ci-fixture', 'platform': 'linux',
                           'helperSha256': hashlib.sha256(helper).hexdigest()}, sort_keys=True).encode()
    files = {'trusted.pub': key, 'manifest.json': manifest, 'manifest.sig': signer.sign(manifest), 'helper': helper}
    for name, contents in files.items():
        path = install / name
        path.write_bytes(contents)
        path.chmod(0o444)
    assert module.verify_release(files['manifest.json'], files['manifest.sig'],
                                 files['trusted.pub'], files['helper'], 'ci-fixture')
    install_spec = importlib.util.spec_from_file_location('ge04_installation', Path(__file__).with_name('signed-installation.py'))
    install_module = importlib.util.module_from_spec(install_spec)
    install_spec.loader.exec_module(install_module)
    assert install_module.verify_installation(install, 0, 'ci-fixture', hashlib.sha256(key).hexdigest()) == hashlib.sha256(helper).hexdigest()
    config = root / 'config'
    config.mkdir(mode=0o755)
    trust = config / 'trust.json'
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': hashlib.sha256(key).hexdigest(), 'release': 'ci-fixture'}))
    trust.chmod(0o444)
    config_spec = importlib.util.spec_from_file_location('ge04_config', Path(__file__).with_name('supervisor-trust-config.py'))
    config_module = importlib.util.module_from_spec(config_spec)
    config_spec.loader.exec_module(config_module)
    assert config_module.verify_from_trust_config(install, config, 0) == hashlib.sha256(helper).hexdigest()
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
            assert os.geteuid() == 65534
            denied = 0
            for name in files:
                try:
                    (install / name).write_bytes(b'forged')
                except PermissionError:
                    denied += 1
            try:
                (install / 'new-manifest').write_bytes(b'forged')
            except PermissionError:
                denied += 1
            try:
                trust.write_bytes(b'forged')
            except PermissionError:
                denied += 1
            try:
                (config / 'replacement').write_bytes(b'forged')
            except PermissionError:
                denied += 1
            os._exit(0 if denied == len(files) + 3 else 1)
        except BaseException:
            os._exit(2)
    _, status = os.waitpid(pid, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, 'worker altered signed installation'
    for name, contents in files.items():
        assert (install / name).read_bytes() == contents
    assert json.loads(trust.read_text())['trustedKeySha256'] == hashlib.sha256(key).hexdigest()
    print('GE04 signed installation distinct-UID PASS: root-owned key, manifest, signature, helper and independent config immutable to worker')
