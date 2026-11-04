#!/usr/bin/env python3
"""SUP-09 real AF_UNIX connections: kernel credentials vs forged JSON."""
import importlib.util
import json
import multiprocessing as mp
import os
from pathlib import Path
import socket
import sys
import tempfile

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-09 requires Linux')
spec = importlib.util.spec_from_file_location('ge04_peercred', Path(__file__).with_name('supervisor-peercred-observation.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def client(path, mode, change_uid):
    if change_uid:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(5)
    try:
        conn.connect(str(path))
        message = {'version': 1, 'attemptId': 'inert-attempt',
                   'declaredUid': os.getuid(), 'declaredPid': os.getpid()}
        if mode == 'forged-pid':
            message['declaredPid'] += 1
        elif mode == 'forged-uid':
            message['declaredUid'] += 1
        elif mode == 'wrong-version':
            message['version'] = True
        raw = json.dumps(message, separators=(',', ':')).encode()
        if mode == 'duplicate':
            raw = raw.replace(b'"version":1', b'"version":2,"version":1')
        if mode == 'oversize':
            raw = b'a' * 2050
        if mode == 'trailing':
            raw += b'garbage'
        conn.sendall(raw + b'\n')
    finally:
        conn.close()


def case(directory, index, mode, accept_expected, change_uid=False, expected_pid_delta=0):
    path = directory / ('peer-' + str(index) + '.sock')
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.settimeout(8)
    try:
        listener.bind(str(path))
        os.chmod(path, 0o666)  # Test fixture only: intentionally reachable by a distinct UID
        listener.listen(1)
        process = mp.Process(target=client, args=(path, mode, change_uid))
        process.start()
        try:
            conn, _ = listener.accept()
            with conn:
                try:
                    observed = module.inspect_peer(
                        conn, 65534 if change_uid else os.getuid(),
                        process.pid + expected_pid_delta)
                except (PermissionError, ValueError):
                    assert not accept_expected, (mode, 'expected acceptance')
                else:
                    assert accept_expected and observed == 'PEER_OBSERVED_UNTRUSTED', mode
        finally:
            process.join(10)
            assert process.exitcode == 0, (mode, process.exitcode)
    finally:
        listener.close()
        path.unlink(missing_ok=True)


with tempfile.TemporaryDirectory(prefix='ge04-sup09-') as name:
    directory = Path(name)
    # Distinct UID clients can traverse to the fixture's socket, but cannot
    # write to this directory. Production must NOT expose this open fixture.
    directory.chmod(0o711)
    for index, (mode, accepted, delta) in enumerate([
        ('valid', True, 0), ('forged-pid', False, 0),
        ('forged-uid', False, 0), ('wrong-version', False, 0),
        ('duplicate', False, 0), ('oversize', False, 0),
        ('trailing', False, 0), ('valid', False, 1),
    ]):
        case(directory, index, mode, accepted, expected_pid_delta=delta)
    if os.geteuid() == 0:
        case(directory, 100, 'valid', True, change_uid=True)
        case(directory, 101, 'forged-uid', False, change_uid=True)
        print('GE04 SUP-09 peercred PASS: real pid/uid, forged inputs, distinct UID and framing denied')
    else:
        print('GE04 SUP-09 peercred local PASS: real pid/uid and forged inputs; distinct-UID unverified')
