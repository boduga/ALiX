#!/usr/bin/env python3
"""Disposable root-launched issuer connected-FD delegation test. Always HOLD."""
import argparse
import array
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile
import time

DENIAL = b'DENIED GE04_SECURITY_HOLD\n'

def drop(user):
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)

def transfer(role, user, channel, path):
    try:
        drop(user)
        with channel:
            channel.settimeout(3)
            if role == 'issuer':
                with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as conn:
                    conn.settimeout(3)
                    conn.connect(path)
                    channel.sendmsg([b'fd'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [conn.fileno()]))])
                return 0
            data, anc, flags, _ = channel.recvmsg(16, socket.CMSG_SPACE(array.array('i').itemsize))
            fds = array.array('i')
            for level, kind, payload in anc:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
            if data != b'fd' or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or len(fds) != 1:
                for fd in fds:
                    os.close(fd)
                return 3
            with socket.socket(fileno=fds[0]) as conn:
                conn.settimeout(3)
                conn.sendall(b'{"approve":true,"issuer":"forged"}')
                return 0 if conn.recv(128) == DENIAL else 4
    except Exception:
        return 5

def run(issuer, attacker, service):
    with tempfile.TemporaryDirectory(prefix='ge04-q32-fd-') as tmp:
        os.chmod(tmp, 0o711)
        private = Path(tmp) / 'issuer'
        private.mkdir(mode=0o700)
        os.chown(private, issuer.pw_uid, issuer.pw_gid)
        sockpath = str(private / 'issuer.sock')
        proc = subprocess.Popen([sys.executable, '-B', str(service), '--isolated-test', '--socket', sockpath],
                                preexec_fn=lambda: drop(issuer), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(150):
                if Path(sockpath).is_socket() or proc.poll() is not None:
                    break
                time.sleep(.02)
            if not Path(sockpath).is_socket():
                raise RuntimeError('issuer listener did not start (verify companion service installation)')
            a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            try:
                children = []
                for role, user, own, other in [('attacker', attacker, b, a), ('issuer', issuer, a, b)]:
                    pid = os.fork()
                    if pid == 0:
                        other.close()
                        os._exit(transfer(role, user, own, sockpath))
                    children.append((role, pid))
            finally:
                a.close()
                b.close()
            codes = {role: os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]) for role, pid in children}
            proc.communicate(timeout=5)
            passed = codes == {'attacker': 0, 'issuer': 0} and proc.returncode == 78
            return {'gate': 'GE04_Q32_ISSUER_FD_DELEGATION', 'disposition': 'HOLD',
                    'qualified_independent_issuance': False, 'delegated_fd_denial_observed': passed,
                    'original_connector_uid': issuer.pw_uid, 'delegated_sender_uid': attacker.pw_uid,
                    'child_exit_codes': codes, 'listener_exit': proc.returncode}
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--isolated-test', action='store_true')
    p.add_argument('--issuer', required=True)
    p.add_argument('--attacker', required=True)
    args = p.parse_args()
    if not args.isolated_test or sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({'gate': 'GE04_Q32_ISSUER_FD_DELEGATION', 'disposition': 'HOLD', 'reason': 'isolated root launch required'}))
        return 78
    try:
        issuer, attacker = pwd.getpwnam(args.issuer), pwd.getpwnam(args.attacker)
        if issuer.pw_uid == 0 or attacker.pw_uid == 0 or issuer.pw_uid == attacker.pw_uid:
            raise ValueError('two distinct nonroot UIDs required')
        result = run(issuer, attacker, Path(__file__).with_name('ge04-q32-deny-issuer-service.py'))
        print(json.dumps(result, sort_keys=True))
        return 0 if result['delegated_fd_denial_observed'] else 78
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'gate': 'GE04_Q32_ISSUER_FD_DELEGATION', 'disposition': 'HOLD', 'reason': str(exc)}))
        return 78

if __name__ == '__main__':
    sys.exit(main())
