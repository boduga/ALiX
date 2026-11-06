#!/usr/bin/env python3
"""Root-launched disposable synthetic issuer custody test. Always HOLD.

No key, credential, authorization, policy service or production paths.
"""
import argparse
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import tempfile

FILES = ('issuer.synthetic', 'policy.synthetic')
GATE = 'GE04_Q32_ISSUER_NEGATIVE_WRITE'


def fail(reason):
    print(json.dumps({'gate': GATE, 'disposition': 'HOLD',
                      'qualified_independent_issuance': False, 'reason': reason}))
    return 78


def worker(directory):
    root = Path(directory)
    attempts = {}
    for name in FILES:
        for operation in ('overwrite', 'unlink', 'rename', 'chmod', 'hardlink', 'symlink_replace'):
            path = root / name
            try:
                if operation == 'overwrite':
                    path.write_bytes(b'ATTACK')
                elif operation == 'unlink':
                    path.unlink()
                elif operation == 'rename':
                    path.rename(root / (name + '.moved'))
                elif operation == 'chmod':
                    path.chmod(0o666)
                elif operation == 'hardlink':
                    os.link(path, root / (name + '.link'))
                else:
                    path.unlink()
                    path.symlink_to('/dev/null')
                attempts[name + ':' + operation] = 'WRITTEN'
            except OSError:
                attempts[name + ':' + operation] = 'DENIED'
    try:
        (root / 'injected.synthetic').write_bytes(b'ATTACK')
        attempts['create'] = 'WRITTEN'
    except OSError:
        attempts['create'] = 'DENIED'
    print(json.dumps({'uid': os.geteuid(), 'attempts': attempts}))
    return 0


def run(args):
    if sys.platform != 'linux' or os.geteuid() != 0 or not args.isolated_test:
        return fail('isolated root launcher required')
    try:
        users = {role: pwd.getpwnam(getattr(args, role)) for role in
                 ('issuer', 'supervisor', 'coordinator', 'attacker')}
        if any(u.pw_uid == 0 for u in users.values()) or len({u.pw_uid for u in users.values()}) != 4:
            return fail('four distinct nonroot identities required')
        with tempfile.TemporaryDirectory(prefix='alix-ge04-issuer-') as directory:
            root = Path(directory)
            os.chown(root, users['issuer'].pw_uid, users['issuer'].pw_gid)
            root.chmod(0o700)
            originals = {}
            for name in FILES:
                path = root / name
                contents = ('INERT SYNTHETIC ' + name).encode()
                path.write_bytes(contents)
                os.chown(path, users['issuer'].pw_uid, users['issuer'].pw_gid)
                path.chmod(0o600)
                originals[name] = (contents, os.lstat(path).st_ino)
            reports = {}
            for role in ('supervisor', 'coordinator', 'attacker'):
                u = users[role]
                def drop(user=u):
                    os.setgroups([])
                    os.setgid(user.pw_gid)
                    os.setuid(user.pw_uid)
                p = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()),
                                    '--worker', '--directory', directory],
                                   preexec_fn=drop, close_fds=True, stdin=subprocess.DEVNULL,
                                   capture_output=True, text=True, timeout=10)
                if p.returncode:
                    return fail(role + ' worker failed: ' + p.stderr[:120])
                reports[role] = json.loads(p.stdout)
            unchanged = all((root / name).is_file() and
                            (root / name).read_bytes() == content and
                            os.lstat(root / name).st_ino == ino and
                            os.lstat(root / name).st_uid == users['issuer'].pw_uid and
                            stat.S_IMODE(os.lstat(root / name).st_mode) == 0o600
                            for name, (content, ino) in originals.items())
            denied = all(reports[role]['uid'] == users[role].pw_uid and
                         len(reports[role]['attempts']) == 13 and
                         all(v == 'DENIED' for v in reports[role]['attempts'].values())
                         for role in reports)
            print(json.dumps({'gate': GATE, 'disposition': 'HOLD',
                              'qualified_independent_issuance': False,
                              'synthetic_fixtures_unchanged': unchanged,
                              'negative_writes_denied': denied,
                              'uids': {k: v.pw_uid for k, v in users.items()},
                              'results': reports}, sort_keys=True))
            return 0 if unchanged and denied else 78
    except (OSError, KeyError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return fail(type(exc).__name__ + ': ' + str(exc)[:120])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    for name in ('issuer', 'supervisor', 'coordinator', 'attacker'):
        parser.add_argument('--' + name)
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--directory', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        if os.geteuid() == 0 or not args.directory or not args.directory.startswith('/tmp/alix-ge04-issuer-'):
            return fail('invalid unprivileged worker')
        return worker(args.directory)
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
