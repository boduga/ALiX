#!/usr/bin/env python3
"""Operator-only synthetic socket access probe; never grants authority."""
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

SERVICE = Path(__file__).with_name('ge04-q32-deny-supervisor-verifier.py')
ROLES = ('issuer', 'supervisor', 'coordinator', 'attacker')


def identity(name):
    account = pwd.getpwnam(name)
    if account.pw_uid == 0:
        raise ValueError('root account forbidden')
    return account.pw_uid, account.pw_gid


def drop(uid, gid):
    def apply():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
    return apply


def client(path, uid, gid):
    code = '''import json,socket,sys
try:
 s=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET)
 s.settimeout(2)
 s.connect(sys.argv[1])
 s.send(json.dumps({'attempt':'synthetic','generation':'1','nonce':'n','audience':'supervisor','operation':'synthetic','target_digest':'d','policy_revision':'1','approved':True}).encode())
 print(json.dumps({'connected':True,'response':json.loads(s.recv(4096))}))
except OSError as e:
 print(json.dumps({'connected':False,'errno':e.errno}))
'''
    p = subprocess.run([sys.executable, '-B', '-c', code, str(path)],
                       preexec_fn=drop(uid, gid), capture_output=True, text=True, timeout=5)
    if p.returncode:
        raise ValueError('client failed')
    return json.loads(p.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    for role in ROLES:
        parser.add_argument('--' + role, required=True)
    args = parser.parse_args()
    base = {'gate':'GE04_Q32_SUPERVISOR_CROSS_UID', 'disposition':'HOLD',
            'qualified_independent_issuance':False, 'real_effects_performed':0}
    if not args.isolated_test or sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({**base, 'reason':'operator root launcher and isolated-test required'}))
        return 78
    try:
        ids = {role:identity(getattr(args,role)) for role in ROLES}
        if len({uid for uid, _ in ids.values()}) != 4:
            raise ValueError('four distinct nonroot UIDs required')
        with tempfile.TemporaryDirectory(prefix='ge04-supervisor-crossuid-') as temp:
            os.chown(temp, *ids['supervisor'])
            os.chmod(temp, 0o711)
            path = Path(temp) / 'verify.sock'
            uid, gid = ids['supervisor']
            proc = subprocess.Popen([sys.executable, '-B', str(SERVICE), '--isolated-test',
                                     '--socket', str(path)], preexec_fn=drop(uid,gid),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                for _ in range(150):
                    if path.exists() or proc.poll() is not None: break
                    time.sleep(.02)
                results = {}
                for role in ('issuer','coordinator','attacker','supervisor'):
                    result = client(path, *ids[role])
                    results[role] = {'uid':ids[role][0], **result}
                    if role == 'supervisor':
                        break
                output, error = proc.communicate(timeout=5)
                denied = all(not results[r]['connected'] for r in ('issuer','coordinator','attacker'))
                supervisor = results['supervisor']
                ok = denied and supervisor['connected'] and supervisor['response']['authorized'] is False and proc.returncode == 78
                print(json.dumps({**base, 'results':results, 'all_denied_or_held':ok,
                                  'service_exit':proc.returncode}, sort_keys=True))
            finally:
                if proc.poll() is None: proc.kill(); proc.wait()
                proc.stdout.close(); proc.stderr.close()
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({**base, 'reason':type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
