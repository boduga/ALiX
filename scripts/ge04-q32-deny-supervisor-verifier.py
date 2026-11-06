#!/usr/bin/env python3
"""Synthetic, deny-only supervisor verification endpoint. Never authorizes effects."""
import argparse
import array
import json
import os
from pathlib import Path
import socket
import sys

DENIAL = {'gate': 'GE04_Q32_SUPERVISOR_VERIFY', 'disposition': 'HOLD',
          'authorized': False, 'real_effects_performed': 0}
FIELDS = ('attempt', 'generation', 'nonce', 'audience', 'operation', 'target_digest', 'policy_revision')


def classify(payload):
    if not isinstance(payload, dict):
        return 'INVALID_REQUEST'
    if any(not isinstance(payload.get(k), str) or not payload[k].strip() for k in FIELDS):
        return 'INVALID_BINDING'
    if payload['audience'] != 'supervisor':
        return 'WRONG_AUDIENCE'
    return 'DENIED_SECURITY_HOLD'


def serve(path):
    if path.exists() or path.is_symlink():
        raise ValueError('socket path already exists')
    with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as server:
        server.bind(str(path))
        os.chmod(path, 0o600)
        server.listen(1)
        server.settimeout(5)
        try:
            conn, _ = server.accept()
            with conn:
                conn.settimeout(3)
                data, anc, flags, _ = conn.recvmsg(4096, socket.CMSG_SPACE(64), getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
                for level, kind, payload in anc:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        fds = array.array('i')
                        fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
                        for fd in fds:
                            os.close(fd)
                if anc or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or not data:
                    reason = 'FD_OR_TRUNCATION_REJECTED'
                else:
                    try:
                        reason = classify(json.loads(data))
                    except (UnicodeError, ValueError):
                        reason = 'INVALID_JSON'
                conn.send(json.dumps({**DENIAL, 'reason': reason}).encode())
                return reason
        finally:
            path.unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--isolated-test', action='store_true')
    p.add_argument('--socket', required=True)
    args = p.parse_args()
    if not args.isolated_test or sys.platform != 'linux' or os.geteuid() == 0:
        print(json.dumps({**DENIAL, 'reason': 'nonroot isolated-test required'}))
        return 78
    try:
        path = Path(args.socket)
        if not path.is_absolute() or not path.parent.is_dir():
            raise ValueError('absolute socket path with existing parent required')
        reason = serve(path)
        print(json.dumps({**DENIAL, 'reason': reason}))
    except (OSError, ValueError) as exc:
        print(json.dumps({**DENIAL, 'reason': type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
