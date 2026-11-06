#!/usr/bin/env python3
"""Nonroot disposable-host deny-only supervisor socket protocol probe."""
import argparse
import array
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

SERVICE = Path(__file__).with_name('ge04-q32-deny-supervisor-verifier.py')
BINDING = {'attempt': 'synthetic-attempt', 'generation': '1', 'nonce': 'synthetic-nonce',
           'audience': 'supervisor', 'operation': 'synthetic',
           'target_digest': 'synthetic-digest', 'policy_revision': '1', 'approved': True}


def exchange(case, tmp):
    path = Path(tmp) / (case + '.sock')
    proc = subprocess.Popen([sys.executable, '-B', str(SERVICE), '--isolated-test',
                             '--socket', str(path)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    try:
        for _ in range(150):
            if path.exists() or proc.poll() is not None:
                break
            time.sleep(.02)
        with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as conn:
            conn.settimeout(3)
            conn.connect(str(path))
            if case == 'delegated_fd':
                with open(Path(tmp) / 'synthetic.txt', 'rb') as fixture:
                    conn.sendmsg([json.dumps(BINDING).encode()], [
                        (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fixture.fileno()]))])
            elif case == 'invalid_json':
                conn.send(b'{invalid')
            elif case == 'wrong_audience':
                conn.send(json.dumps({**BINDING, 'audience': 'attacker'}).encode())
            else:
                conn.send(json.dumps(BINDING).encode())
            response = json.loads(conn.recv(4096))
        stdout, stderr = proc.communicate(timeout=5)
        expected = {'delegated_fd': 'FD_OR_TRUNCATION_REJECTED',
                    'invalid_json': 'INVALID_JSON', 'wrong_audience': 'WRONG_AUDIENCE',
                    'apparently_valid': 'DENIED_SECURITY_HOLD'}[case]
        return {'reason': response.get('reason'), 'exit': proc.returncode,
                'pass': (response.get('authorized') is False and
                         response.get('disposition') == 'HOLD' and
                         response.get('real_effects_performed') == 0 and
                         response.get('reason') == expected and proc.returncode == 78)}
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stdout.close()
        proc.stderr.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    args = parser.parse_args()
    result = {'gate': 'GE04_Q32_SUPERVISOR_SOCKET_HOST', 'disposition': 'HOLD',
              'qualified_independent_issuance': False, 'real_effects_performed': 0}
    if not args.isolated_test or sys.platform != 'linux' or os.geteuid() == 0:
        print(json.dumps({**result, 'reason': 'nonroot Linux isolated-test required'}))
        return 78
    try:
        with tempfile.TemporaryDirectory(prefix='ge04-q32-supervisor-') as tmp:
            (Path(tmp) / 'synthetic.txt').write_text('SYNTHETIC_ONLY\n')
            cases = {case: exchange(case, tmp) for case in
                     ('apparently_valid', 'wrong_audience', 'invalid_json', 'delegated_fd')}
        print(json.dumps({**result, 'uid': os.geteuid(), 'cases': cases,
                          'all_denied': all(v['pass'] for v in cases.values())}, sort_keys=True))
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({**result, 'reason': type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
