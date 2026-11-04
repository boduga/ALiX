#!/usr/bin/env python3
"""GE04 root-gated no-execution composition test; rejects uncertain ledger."""
import fcntl
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
    raise SystemExit('GE04 trusted supervisor preparation REQUIRES root')
spec = importlib.util.spec_from_file_location('ge04_prepare', Path(__file__).with_name('trusted-supervisor-preparation.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='ge04-prepare-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    config, release, floor, evidence = [root / name for name in ('config', 'release', 'floor', 'evidence')]
    for directory in (config, release, floor, evidence):
        directory.mkdir(mode=0o700)
    signer = Ed25519PrivateKey.generate()
    key = signer.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    helper = b'GE04 unexecuted signed helper'
    digest = hashlib.sha256(helper).hexdigest()
    manifest = json.dumps({'version': 2, 'release': 'generation-12', 'platform': 'linux',
                           'helperSha256': digest, 'sequence': 12}).encode()
    for name, data in {'trusted.pub': key, 'manifest.json': manifest,
                       'manifest.sig': signer.sign(manifest), 'helper': helper}.items():
        target = release / name
        target.write_bytes(data)
        target.chmod(0o400)
    trust = config / 'trust.json'
    trust.write_text(json.dumps({'version': 1, 'trustedKeySha256': hashlib.sha256(key).hexdigest(),
                                 'release': 'generation-12'}))
    trust.chmod(0o400)
    floor_file = floor / 'floor.json'
    floor_file.write_text(json.dumps({'version': 1, 'minimumSequence': 12}))
    floor_file.chmod(0o400)

    fd, observed, sequence = module.prepare(config, release, floor, evidence)
    try:
        assert (observed, sequence) == (digest, 12)
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        assert fcntl.fcntl(fd, fcntl.F_GET_SEALS) & seals == seals
        try:
            os.pwrite(fd, b'X', 0)
        except OSError:
            pass
        else:
            raise AssertionError('verified snapshot was writable')
    finally:
        os.close(fd)

    def denied(label):
        try:
            rogue_fd, _, _ = module.prepare(config, release, floor, evidence)
        except (OSError, ValueError, PermissionError):
            return
        else:
            os.close(rogue_fd)
            raise AssertionError('GE04 accepted ' + label)

    # This must NOT treat a signed but downgraded generation as acceptable.
    floor_file.chmod(0o600)
    floor_file.write_text(json.dumps({'version': 1, 'minimumSequence': 13}))
    floor_file.chmod(0o400)
    denied('rollback below configured floor')
    floor_file.chmod(0o600)
    floor_file.write_text(json.dumps({'version': 1, 'minimumSequence': 12}))
    floor_file.chmod(0o400)

    (evidence / 'unknown.tmp').write_text('unreconciled')
    denied('uncertain evidence inventory')
    (evidence / 'unknown.tmp').unlink()
    (release / 'helper').chmod(0o600)
    (release / 'helper').write_bytes(b'tampered helper bytes')
    (release / 'helper').chmod(0o400)
    denied('helper content not covered by signed digest')

print('GE04 trusted supervisor preparation PASS: sealed signed bytes; rollback, uncertain evidence and tamper denied')
