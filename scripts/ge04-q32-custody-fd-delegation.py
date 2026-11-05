#!/usr/bin/env python3
"""Disposable synthetic authority-file FD delegation observation; always HOLD.

Operator-only root launch on an isolated Linux host. Never real authority.
"""
import argparse
import array
import json
import os
from pathlib import Path
import pwd
import socket
import sys
import tempfile

ROLES = ('issuer', 'attacker')


def drop(user):
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)


def child(user, role, channel, fixture, writable):
    try:
        drop(user)
        if role == 'issuer':
            fd = os.open(fixture, os.O_RDWR if writable else os.O_RDONLY)
            try:
                channel.sendmsg([b'fd'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
            finally:
                os.close(fd)
            return {'uid': os.geteuid(), 'sent': True}
        data, ancillary, flags, _ = channel.recvmsg(16, socket.CMSG_SPACE(array.array('i').itemsize))
        fds = array.array('i')
        for level, kind, payload in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
        if data != b'fd' or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or len(fds) != 1:
            for fd in fds:
                os.close(fd)
            return {'uid': os.geteuid(), 'error': 'invalid_fd_transfer'}
        fd = fds[0]
        try:
            content = os.pread(fd, 128, 0)
            try:
                os.pwrite(fd, b'X', 0)
                write = 'ALLOWED'
            except OSError:
                write = 'DENIED'
            return {'uid': os.geteuid(), 'delegated_read': content.startswith(b'SYNTHETIC'),
                    'delegated_write': write}
        finally:
            os.close(fd)
    except BaseException as exc:
        return {'uid': os.geteuid(), 'error': type(exc).__name__}


def spawn(user, role, channel, other, fixture, writable):
    result_r, result_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(result_r)
        other.close()
        result = child(user, role, channel, fixture, writable)
        os.write(result_w, json.dumps(result).encode())
        os.close(result_w)
        channel.close()
        os._exit(0)
    os.close(result_w)
    return pid, result_r


def run(users):
    with tempfile.TemporaryDirectory(prefix='ge04-q32-fd-custody-') as tmp:
        root = Path(tmp)
        root.chmod(0o711)
        private = root / 'issuer'
        private.mkdir(mode=0o700)
        os.chown(private, users['issuer'].pw_uid, users['issuer'].pw_gid)
        fixture = private / 'synthetic.txt'
        fixture.write_bytes(b'SYNTHETIC_AUTHORITY_ONLY\n')
        os.chown(fixture, users['issuer'].pw_uid, users['issuer'].pw_gid)
        fixture.chmod(0o600)
        outcomes = {}
        for writable in (False, True):
            fixture.write_bytes(b'SYNTHETIC_AUTHORITY_ONLY\n')
            a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            try:
                attacker_pid, attacker_result = spawn(users['attacker'], 'attacker', b, a, fixture, writable)
                issuer_pid, issuer_result = spawn(users['issuer'], 'issuer', a, b, fixture, writable)
            finally:
                a.close(); b.close()
            reports = {}
            for role, pid, pipe in [('attacker', attacker_pid, attacker_result), ('issuer', issuer_pid, issuer_result)]:
                payload = os.read(pipe, 4096)
                os.close(pipe)
                _, status = os.waitpid(pid, 0)
                reports[role] = json.loads(payload) if payload and os.waitstatus_to_exitcode(status) == 0 else {'error': 'child_failed'}
            reports['fixture_modified'] = fixture.read_bytes() != b'SYNTHETIC_AUTHORITY_ONLY\n'
            outcomes['writable' if writable else 'readonly'] = reports
        ro = outcomes['readonly']; rw = outcomes['writable']
        observed = (ro['attacker'].get('delegated_read') is True and
                    ro['attacker'].get('delegated_write') == 'DENIED' and not ro['fixture_modified'] and
                    rw['attacker'].get('delegated_read') is True and
                    rw['attacker'].get('delegated_write') == 'ALLOWED' and rw['fixture_modified'])
        return {'gate': 'GE04_Q32_CUSTODY_FD_DELEGATION', 'disposition': 'HOLD',
                'delegated_descriptor_risk_observed': observed, 'qualified_independent_issuance': False,
                'real_effects_performed': 0, 'results': outcomes,
                'uids': {role: user.pw_uid for role, user in users.items()},
                'limits': 'synthetic_fixture_only_no_real_issuer_or_effect_authority'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    for role in ROLES:
        parser.add_argument('--' + role, required=True)
    args = parser.parse_args()
    if not args.isolated_test or sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({'gate': 'GE04_Q32_CUSTODY_FD_DELEGATION', 'disposition': 'HOLD',
                          'reason': 'operator root and isolated-test required'}))
        return 78
    try:
        users = {role: pwd.getpwnam(getattr(args, role)) for role in ROLES}
        if len({user.pw_uid for user in users.values()}) != 2 or any(user.pw_uid == 0 for user in users.values()):
            raise ValueError('two distinct nonroot UIDs required')
        print(json.dumps(run(users), sort_keys=True))
    except (KeyError, OSError, ValueError) as exc:
        print(json.dumps({'gate': 'GE04_Q32_CUSTODY_FD_DELEGATION', 'disposition': 'HOLD', 'reason': str(exc)}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
