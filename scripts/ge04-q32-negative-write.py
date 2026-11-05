#!/usr/bin/env python3
"""Disposable-host Q3.2 cross-UID negative-write probe. NEVER production custody.

Operator-run root launcher; only creates/removes files inside its own tempdir.
All attempted writes are confined to supervisor-owned synthetic fixtures.
"""
import argparse
import grp
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import tempfile

NAMES = ('policy.json', 'claims.sqlite', 'issuer.pub')


def fail(reason):
    print(json.dumps({'gate': 'GE04_Q32_NEGATIVE_WRITE', 'disposition': 'HOLD',
                      'qualified_independent_custody': False, 'reason': reason}))
    return 78


def lookup(name):
    u = pwd.getpwnam(name)
    if u.pw_uid == 0:
        raise ValueError('test identity must be nonroot')
    return u


def worker(directory):
    root = Path(directory)
    attempts = {}
    for name in NAMES:
        for action in ('overwrite', 'unlink', 'rename'):
            target = root / name
            try:
                if action == 'overwrite':
                    with target.open('wb') as handle:
                        handle.write(b'UNTRUSTED WRITE')
                elif action == 'unlink':
                    target.unlink()
                else:
                    target.rename(root / (name + '.moved'))
                attempts[name + ':' + action] = 'WRITTEN'
            except OSError:
                attempts[name + ':' + action] = 'DENIED'
    try:
        (root / 'injected.json').write_bytes(b'UNTRUSTED WRITE')
        attempts['create'] = 'WRITTEN'
    except OSError:
        attempts['create'] = 'DENIED'
    print(json.dumps({'uid': os.geteuid(), 'attempts': attempts}), flush=True)
    return 0


def run(args):
    if sys.platform != 'linux' or os.geteuid() != 0 or not args.isolated_test:
        return fail('explicit isolated root launcher required')
    try:
        supervisor, coordinator, attacker = [lookup(n) for n in
                                             (args.supervisor, args.coordinator, args.attacker)]
        if len({supervisor.pw_uid, coordinator.pw_uid, attacker.pw_uid}) != 3:
            raise ValueError('three distinct UIDs required')
        group = grp.getgrnam(args.group)
        if coordinator.pw_name not in group.gr_mem and coordinator.pw_gid != group.gr_gid:
            raise ValueError('coordinator must belong to group')
        if attacker.pw_name in group.gr_mem or attacker.pw_gid == group.gr_gid:
            raise ValueError('attacker must not belong to group')
        with tempfile.TemporaryDirectory(prefix='alix-ge04-q32-') as temporary:
            root = Path(temporary)
            os.chown(root, supervisor.pw_uid, group.gr_gid)
            os.chmod(root, 0o700)
            originals = {}
            for name in NAMES:
                target = root / name
                original = ('SYNTHETIC TEST FIXTURE ' + name).encode()
                target.write_bytes(original)
                os.chown(target, supervisor.pw_uid, group.gr_gid)
                target.chmod(0o600)
                originals[name] = original
            results = {}
            for label, user in (('coordinator', coordinator), ('attacker', attacker)):
                def drop(u=user):
                    os.setgroups([])
                    os.setgid(u.pw_gid)
                    os.setuid(u.pw_uid)
                proc = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()),
                                       '--worker', '--directory', temporary],
                                      preexec_fn=drop, close_fds=True, stdin=subprocess.DEVNULL,
                                      capture_output=True, text=True, timeout=10)
                if proc.returncode != 0:
                    return fail(label + ' worker failed: ' + proc.stderr[:120])
                report = json.loads(proc.stdout)
                results[label] = report
            unchanged = all((root / name).is_file() and
                            (root / name).read_bytes() == content and
                            os.lstat(root / name).st_uid == supervisor.pw_uid and
                            stat.S_IMODE(os.lstat(root / name).st_mode) == 0o600
                            for name, content in originals.items())
            denied = all(report['uid'] == user.pw_uid and
                         len(report['attempts']) == 10 and
                         all(value == 'DENIED' for value in report['attempts'].values())
                         for report, user in ((results['coordinator'], coordinator),
                                              (results['attacker'], attacker)))
            print(json.dumps({'gate': 'GE04_Q32_NEGATIVE_WRITE', 'disposition': 'HOLD',
                              'qualified_independent_custody': False,
                              'synthetic_fixtures_unchanged': unchanged,
                              'negative_writes_denied': denied,
                              'supervisor_uid': supervisor.pw_uid,
                              'coordinator_uid': coordinator.pw_uid,
                              'attacker_uid': attacker.pw_uid, 'results': results}, sort_keys=True))
            return 0 if unchanged and denied else 78
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return fail(type(exc).__name__ + ': ' + str(exc)[:160])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--isolated-test', action='store_true')
    p.add_argument('--supervisor')
    p.add_argument('--coordinator')
    p.add_argument('--attacker')
    p.add_argument('--group')
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    p.add_argument('--directory', help=argparse.SUPPRESS)
    args = p.parse_args()
    if args.worker:
        if not args.directory or os.geteuid() == 0 or not args.directory.startswith('/tmp/alix-ge04-q32-'):
            return fail('invalid unprivileged worker')
        return worker(args.directory)
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
