#!/usr/bin/env python3
"""Root-launched, disposable-host-only cross-UID denial experiment. Always HOLD."""
import argparse
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile
import time

ROLES = ('issuer', 'supervisor', 'coordinator', 'attacker')
DENIAL = b'DENIED GE04_SECURITY_HOLD\n'


def accounts(names):
    ids = {role: pwd.getpwnam(names[role]) for role in ROLES}
    if len({v.pw_uid for v in ids.values()}) != 4 or any(v.pw_uid == 0 for v in ids.values()):
        raise ValueError('four distinct nonroot UIDs required')
    return ids


def drop(user):
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)


def connect_as(user, path):
    pid = os.fork()
    if pid == 0:
        try:
            drop(user)
            with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as s:
                s.settimeout(2)
                s.connect(path)
                s.sendall(b'{"approve":true,"issuer":"forged"}')
                reply = s.recv(128)
            os._exit(0 if reply == DENIAL else 2)
        except PermissionError:
            os._exit(13)
        except Exception:
            os._exit(3)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


def run(ids, service):
    with tempfile.TemporaryDirectory(prefix='ge04-q32-cross-uid-') as tmp:
        os.chmod(tmp, 0o711)  # root-owned traversal only; issuer child remains 0700
        directory = Path(tmp) / 'issuer'
        directory.mkdir(mode=0o700)
        os.chown(directory, ids['issuer'].pw_uid, ids['issuer'].pw_gid)
        path = str(directory / 'issuer.sock')
        process = subprocess.Popen([sys.executable, '-B', str(service), '--isolated-test',
                                    '--socket', path, '--max-connections', '1'],
                                   preexec_fn=lambda: drop(ids['issuer']),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(200):
                if Path(path).exists():
                    break
                if process.poll() is not None:
                    break
                time.sleep(.02)
            if not Path(path).exists():
                raise RuntimeError('issuer listener did not start')
            results = {role: connect_as(ids[role], path) for role in ROLES if role != 'issuer'}
            issuer_result = connect_as(ids['issuer'], path)
            out, err = process.communicate(timeout=5)
            passed = all(code == 13 for code in results.values()) and issuer_result == 0 and process.returncode == 78
            return {'gate': 'GE04_Q32_ISSUER_CROSS_UID', 'disposition': 'HOLD',
                    'qualified_independent_issuance': False, 'negative_connects_denied': passed,
                    'cross_uid_exit_codes': results, 'issuer_denial_received': issuer_result == 0,
                    'listener_exit': process.returncode, 'uids': {k: v.pw_uid for k, v in ids.items()}}
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--isolated-test', action='store_true')
    for role in ROLES:
        p.add_argument('--' + role, required=True)
    args = p.parse_args()
    if not args.isolated_test or os.geteuid() != 0 or sys.platform != 'linux':
        print(json.dumps({'gate': 'GE04_Q32_ISSUER_CROSS_UID', 'disposition': 'HOLD', 'reason': 'root and isolated-test required'}))
        return 78
    try:
        ids = accounts(vars(args))
        result = run(ids, Path(__file__).with_name('ge04-q32-deny-issuer-service.py'))
        print(json.dumps(result, sort_keys=True))
        return 0 if result['negative_connects_denied'] else 78
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'gate': 'GE04_Q32_ISSUER_CROSS_UID', 'disposition': 'HOLD', 'reason': str(exc)}))
        return 78

if __name__ == '__main__':
    sys.exit(main())
