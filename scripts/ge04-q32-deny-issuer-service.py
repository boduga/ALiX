#!/usr/bin/env python3
"""Disposable-host deny-only issuer process; no keys, tokens, or effect authority."""
import argparse
import json
import os
from pathlib import Path
import socket
import stat
import sys

DENIAL = b'DENIED GE04_SECURITY_HOLD\n'
MAX_FRAME = 4096


def serve(socket_path, *, max_connections=1):
    if sys.platform != 'linux' or os.geteuid() == 0:
        raise ValueError('linux nonroot identity required')
    path = Path(socket_path)
    if not path.is_absolute() or path.is_symlink() or path.exists():
        raise ValueError('absolute nonexistent socket path required')
    parent = path.parent
    parent_stat = os.lstat(parent)
    if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid != os.geteuid() or stat.S_IMODE(parent_stat.st_mode) != 0o700:
        raise ValueError('private issuer-owned 0700 directory required')
    if max_connections < 1 or max_connections > 20:
        raise ValueError('bounded connections required')
    with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as server:
        server.bind(str(path))
        os.chmod(path, 0o600)
        server.listen(4)
        server.settimeout(10)
        try:
            for _ in range(max_connections):
                with server.accept()[0] as conn:
                    conn.settimeout(3)
                    # Never interpret a request as authorization. Always deny.
                    try:
                        conn.recv(MAX_FRAME + 1)
                    except (OSError, TimeoutError):
                        pass
                    try:
                        conn.sendall(DENIAL)
                    except OSError:
                        pass
        finally:
            if path.exists() and path.is_socket():
                path.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    parser.add_argument('--socket', required=True)
    parser.add_argument('--max-connections', type=int, default=1)
    args = parser.parse_args()
    if not args.isolated_test:
        print(json.dumps({'gate': 'GE04_Q32_DENY_ISSUER', 'disposition': 'HOLD', 'reason': 'isolated-test required'}))
        return 78
    try:
        serve(args.socket, max_connections=args.max_connections)
    except (ValueError, OSError) as exc:
        print(json.dumps({'gate': 'GE04_Q32_DENY_ISSUER', 'disposition': 'HOLD', 'reason': str(exc)}))
        return 78
    print(json.dumps({'gate': 'GE04_Q32_DENY_ISSUER', 'disposition': 'HOLD', 'qualified_independent_issuance': False}))
    return 78

if __name__ == '__main__':
    sys.exit(main())
