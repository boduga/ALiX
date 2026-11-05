#!/usr/bin/env python3
"""GE-04 pinned native descriptor regression. Root-only experimental fixture."""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 pinned native executable requires Linux root')

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'ge04_pinned', BASE / 'supervisor-pinned-native-fixture.py')
pinned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinned)

with tempfile.TemporaryDirectory(prefix='ge04-pinned-native-') as name:
    root = Path(name)
    root.chmod(0o700)
    binary = root / 'native'
    result = subprocess.run(
        ['gcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
         str(BASE / 'final-boundary-inert-kernel-create.c'), '-o', str(binary)],
        capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    binary.chmod(0o700)
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    owned = root / 'owned'
    owned.mkdir(mode=0o700)
    owned_fd = os.open(owned, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        def denied(action):
            try:
                action()
            except (PermissionError, ValueError, OSError):
                return
            raise AssertionError('unsafe native image accepted')

        denied(lambda: pinned.pin_binary(binary, '0' * 64))
        assert binary.is_file()
        assert not (owned / 'ge04-inert-effect.bin').exists()

        # Opened ELF inode stays pinned if its name is replaced. This verifies
        # descriptor selection, not protection against root editing the inode.
        image_fd = pinned.pin_binary(binary, digest)
        try:
            replaced = root / 'old-native'
            binary.rename(replaced)
            binary.write_bytes(b'ATTACKER_REPLACED_PATH')
            binary.chmod(0o700)
            outcome = pinned.run_pinned(image_fd, owned_fd)
            assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
            assert outcome.stdout.strip() == 'GE04_NATIVE_FIXTURE_FSYNCED_UNVERIFIED'
            assert (owned / 'ge04-inert-effect.bin').is_file()
        finally:
            os.close(image_fd)

        symlink = root / 'link-native'
        symlink.symlink_to(replaced)
        denied(lambda: pinned.pin_binary(symlink, digest))
        denied(lambda: pinned.pin_binary(binary, digest))
        replaced.chmod(0o777)
        denied(lambda: pinned.pin_binary(replaced, digest))
        replaced.chmod(0o700)
        hardlink = root / 'hard-native'
        os.link(replaced, hardlink)
        denied(lambda: pinned.pin_binary(replaced, digest))
        hardlink.unlink()

        fake = root / 'fake-native'
        fake.write_bytes(b'NOT_ELF')
        fake.chmod(0o700)
        denied(lambda: pinned.pin_binary(fake, hashlib.sha256(fake.read_bytes()).hexdigest()))
    finally:
        os.close(owned_fd)

print('GE04 pinned native descriptor PASS: digest, symlink, hardlink and pathname substitution denied or pinned; HOLD')
