#!/usr/bin/env python3
"""SUP-13 real Linux Unix-stream fixture, no authority or governed mutation."""
import hashlib
import importlib.util
import multiprocessing as mp
import os
from pathlib import Path
import socket
import sys
import tempfile

if sys.platform != 'linux' or not hasattr(os, 'pidfd_open'):
    raise SystemExit('GE04 SUP-13 requires Linux pidfd')

def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

transport = load('real-ipc-session-transport')
endpoint = load('supervisor-endpoint-bootstrap')
role = load('supervisor-role-observation')
KEY = os.urandom(32)
LABEL = b'fixture-coordinator-not-authority'
DIGEST = hashlib.sha256(b'inert').digest()

def client(path, mode, output):
    try:
        secret = os.urandom(32) if mode == 'wrong-secret' else KEY
        peer = b'wrong-peer' if mode == 'wrong-peer' else LABEL
        result = transport.client_exchange(path, secret, peer, DIGEST,
                                           'valid' if mode in ('wrong-secret', 'wrong-peer', 'wrong-expected-pid') else mode)
        output.put(('reply', result))
    except (OSError, ValueError, PermissionError, ConnectionError, TimeoutError):
        output.put(('rejected', 'UNCERTAIN'))


with tempfile.TemporaryDirectory(prefix='ge04-sup13-', dir=Path.home()) as name:
    root = Path(name)
    root.chmod(0o700)
    for index, mode in enumerate([
        'valid', 'tamper', 'invalid-proof', 'oversize', 'disconnect',
        'request-disconnect', 'wrong-secret', 'wrong-peer', 'wrong-expected-pid',
    ]):
        directory = root / f'case-{index}'
        directory.mkdir(mode=0o700)
        server = endpoint.bootstrap(directory, os.geteuid())
        output = mp.Queue()
        process = mp.Process(target=client, args=(directory / 'supervisor.sock', mode, output))
        process.start()
        try:
            expected_exe, expected_start = role.snapshot(process.pid)
            expected_pid = process.pid + (1 if mode == 'wrong-expected-pid' else 0)
            outcome = transport.serve_one(server, KEY, LABEL, os.geteuid(),
                                          expected_pid, expected_exe, expected_start)
            process.join(8)
            assert process.exitcode == 0, (mode, process.exitcode)
            result_kind, response = output.get(timeout=3)
            if mode == 'valid':
                assert outcome == 'TRANSPORT_OUTCOME_UNVERIFIED', outcome
                assert (result_kind, response) == ('reply', 'REQUEST_OBSERVED_UNTRUSTED')
            else:
                assert outcome == 'UNCERTAIN', (mode, outcome, result_kind, response)
                assert response != 'REQUEST_OBSERVED_UNTRUSTED'
        finally:
            server.close()
            if process.is_alive():
                process.terminate()
                process.join(5)

print('GE04 SUP-13 real IPC transport PASS: socket handshake, peer observation, tamper and disconnect fail closed')
