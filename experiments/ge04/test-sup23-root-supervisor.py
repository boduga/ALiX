#!/usr/bin/env python3
"""SUP-23 privileged separate-process inert supervisor boundary regression."""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-23 requires root on Linux')

base = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'sup23_credential', base / 'fixture-credential-provisioning.py')
credential = importlib.util.module_from_spec(spec)
spec.loader.exec_module(credential)


def untrusted_probe(root):
    code = """
import os, pathlib, socket, sys
root = pathlib.Path(sys.argv[1])
key = root / 'coordinator.fixture.key'
endpoint = root / 'supervisor-dgram.sock'
assert os.geteuid() == 65534
for operation in (
    lambda: key.read_bytes(),
    lambda: socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM).sendto(
        b'SUP23_INERT_PROBE', str(endpoint)),
):
    try:
        operation()
    except PermissionError:
        pass
    else:
        raise AssertionError('untrusted UID reached supervisor protected resource')
print('SUP23_UNTRUSTED_DENIED')
"""
    def drop():
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    return subprocess.run(
        [sys.executable, '-B', '-c', code, str(root)],
        close_fds=True, pass_fds=(), preexec_fn=drop,
        text=True, capture_output=True, timeout=8)


with tempfile.TemporaryDirectory(prefix='ge04-sup23-') as directory:
    root = Path(directory)
    root.chmod(0o700)
    assert credential.install_fixture_key(root) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    reply = root / 'coordinator-reply.sock'
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as listener:
        listener.bind(str(reply))
        reply.chmod(0o600)
        listener.settimeout(8)
        process = subprocess.Popen(
            [sys.executable, '-B', str(base / 'sup23-root-supervisor.py'),
             str(root), str(os.getpid())],
            close_fds=True, pass_fds=(),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            assert process.pid != os.getpid()
            assert process.stdout.readline().strip() == 'SUP23_READY'
            endpoint = root / 'supervisor-dgram.sock'
            entry = endpoint.lstat()
            assert stat.S_ISSOCK(entry.st_mode)
            assert entry.st_uid == 0 and entry.st_mode & 0o077 == 0
            result = untrusted_probe(root)
            assert result.returncode == 0, (result.stdout, result.stderr)
            assert result.stdout.strip() == 'SUP23_UNTRUSTED_DENIED'
            assert process.poll() is None
            # The coordinator never receives or handles a supervisor
            # credential descriptor. Its request is an inert fixed probe.
            with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sender:
                sender.sendto(b'SUP23_INERT_PROBE', str(endpoint))
            assert listener.recv(128) == b'SUP23_OBSERVED_UNTRUSTED'
            assert process.wait(timeout=8) == 0, process.stderr.read()
            # No process remains behind the orphaned endpoint. The fixture
            # does not silently unlink it or mistake it for a live service.
            assert endpoint.exists()
            denied = False
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as orphan:
                    orphan.sendto(b'SUP23_INERT_PROBE', str(endpoint))
            except ConnectionRefusedError:
                denied = True
            assert denied, 'stale supervisor endpoint was unexpectedly live'
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=8)
            process.stdout.close()
            process.stderr.close()

print('GE04 SUP-23 root supervisor fixture PASS: isolated process; distinct UID denied; inert pidfd message accepted; stale socket denied')
