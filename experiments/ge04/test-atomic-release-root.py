#!/usr/bin/env python3
"""Root-only atomic generation publication and rollback-denial experiment."""
import errno
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
    raise SystemExit('GE04 atomic generation test REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_release', Path(__file__).with_name('trusted-release-verification.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

with tempfile.TemporaryDirectory(prefix='ge04-generations-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    config = root / 'config'
    config.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    pin = hashlib.sha256(key).hexdigest()
    trust = config / 'trust.json'
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': pin, 'release': 'generation-2'}))
    trust.chmod(0o400)

    def publish(version):
        stage = root / ('.stage-' + version)
        stage.mkdir(mode=0o700)
        helper = ('GE04 ' + version).encode()
        manifest = json.dumps({'version': 1, 'release': version, 'platform': 'linux',
                               'helperSha256': hashlib.sha256(helper).hexdigest()}).encode()
        contents = {'trusted.pub': key, 'manifest.json': manifest,
                    'manifest.sig': signer.sign(manifest), 'helper': helper}
        for name, data in contents.items():
            fd = os.open(stage / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o400)
            try:
                os.write(fd, data)
                os.fsync(fd)
            finally:
                os.close(fd)
        dirfd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
        final = root / version
        os.rename(stage, final)  # Unique destination: never overwrite a published generation.
        rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(rootfd)
        finally:
            os.close(rootfd)
        return final, hashlib.sha256(helper).hexdigest()

    partial = root / '.incomplete'
    partial.mkdir(mode=0o700)
    (partial / 'helper').write_bytes(b'incomplete')
    try:
        verifier.verify(config, partial, 0)
    except (OSError, ValueError, PermissionError):
        pass
    else:
        raise AssertionError('incomplete staging directory verified')
    old, old_digest = publish('generation-1')
    try:
        verifier.verify(config, old, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('rollback generation accepted against protected current release')
    current, current_digest = publish('generation-2')
    assert verifier.verify(config, current, 0) == current_digest
    assert old_digest != current_digest
    try:
        os.rename(old, current)
    except OSError as exc:
        if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
            raise
    else:
        raise AssertionError('published generation replaced by rename')
print('GE04 atomic generations root PASS: fsynced staged publication, current release accepted, rollback denied')
