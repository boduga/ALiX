#!/usr/bin/env python3
"""SUP-24 root-only fresh-process challenge lifecycle and replay denial."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('SUP-24 requires Linux root')

base = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'fixture_keys', base / 'fixture-credential-provisioning.py')
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)


def exchange(mode, prior=None):
    with tempfile.TemporaryDirectory(prefix='ge04-sup24-') as directory:
        root = Path(directory)
        root.chmod(0o700)
        assert keys.install_fixture_key(root) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as reply:
            reply.bind(str(root / 'sup24-reply.sock'))
            (root / 'sup24-reply.sock').chmod(0o600)
            reply.settimeout(4)
            process = subprocess.Popen(
                [sys.executable, '-B', str(base / 'sup24-root-supervisor.py'),
                 str(root), str(os.getpid())],
                close_fds=True, pass_fds=(),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                assert process.stdout.readline().strip() == 'SUP24_READY'
                endpoint = root / 'sup24-supervisor.sock'
                with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sender:
                    sender.sendto(b'SUP24_HELLO', str(endpoint))
                    challenge = reply.recv(128)
                    assert challenge.startswith(b'SUP24_CHALLENGE:')
                    fresh = challenge.split(b':', 1)[1]
                    assert len(fresh) == 64
                    candidate = prior if mode == 'replay' else fresh
                    if mode == 'invalid':
                        candidate = b'0' * 64
                    sender.sendto(b'SUP24_RESPONSE:' + candidate, str(endpoint))
                if mode == 'valid':
                    assert reply.recv(128) == b'SUP24_OBSERVED_UNTRUSTED'
                    assert process.wait(timeout=5) == 0, process.stderr.read()
                    assert process.stdout.readline().strip() == 'SUP24_INERT_SESSION_OBSERVED'
                else:
                    assert process.wait(timeout=5) != 0, 'stale/invalid challenge was accepted'
                    reply.settimeout(0.1)
                    try:
                        leaked = reply.recv(128)
                    except socket.timeout:
                        pass
                    else:
                        raise AssertionError('failed session emitted response: ' + repr(leaked))
                return fresh
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()


original = exchange('valid')
assert exchange('valid') != original, 'fresh exec reused challenge'
exchange('replay', original)
exchange('invalid')
assert exchange('valid') not in (original,), 'unexpected repeated fresh challenge'
print('GE04 SUP-24 session lifecycle PASS: separate exec freshness; stale replay denied; invalid response denied; recovery observed')
