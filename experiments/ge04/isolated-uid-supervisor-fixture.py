#!/usr/bin/env python3
"""GE-04 independent-UID boundary fixture: privileged owner, inert datagram only.

The root-only provisioner launches this process; the untrusted coordinator
has another UID. This is not a production service or proof against root.
"""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import sys


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_isolation_' + name.replace('-', '_'),
        Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


sender = load('kernel-bound-datagram-sender')
authority = load('sup25-atomic-authority-fixture')
receipt = load('sup26-inert-terminal-evidence')
keys = load('fixture-credential-provisioning')


def run(private, public, coordinator_pid, coordinator_uid):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('root Linux fixture service required')
    private = Path(private)
    public = Path(public)
    for root, expected_mode in ((private, 0o700), (public, 0o711)):
        fd = os.open(root, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            s = os.fstat(fd)
            if (not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or
                    s.st_mode & 0o777 != expected_mode):
                raise PermissionError('invalid privileged fixture directory')
        finally:
            os.close(fd)
    if len(keys.read_fixture_key(private, 0)) != 32:
        raise PermissionError('missing protected credential')
    endpoint = public / 'inert-request.sock'
    try:
        endpoint.lstat()
    except FileNotFoundError:
        pass
    else:
        raise FileExistsError('stale endpoint must be recovered explicitly')
    with sender.KernelPinnedSender(coordinator_pid, coordinator_uid) as pin:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as channel:
            sender.configure_receiver(channel)
            channel.bind(str(endpoint))
            os.chmod(endpoint, 0o666)
            channel.settimeout(8)
            print('GE04_ISOLATED_SUPERVISOR_READY', flush=True)
            if pin.receive(channel) != b'GE04_ISOLATED_INERT_REQUEST':
                raise PermissionError('unsupported inert operation')
            result = authority.attempt(
                private, attempt_id='isolated-inert-attempt',
                approval='fixture-approval', lease='fixture-lease',
                revision=7, now_ms=100)
            if result != 'SUP25_INERT_OUTCOME_UNVERIFIED':
                raise PermissionError('inert authority transition missing')
            receipt.persist_observation(private, 'isolated-inert-attempt')
            if receipt.classify(private, 'isolated-inert-attempt') != (
                    'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'):
                raise PermissionError('inert observation unavailable')
            print('GE04_ISOLATED_INERT_OBSERVATION_UNVERIFIED', flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('usage: service.py PRIVATE PUBLIC COORDINATOR_PID COORDINATOR_UID')
    run(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
