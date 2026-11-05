#!/usr/bin/env python3
"""Operator-run disposable Linux cross-UID filesystem custody probe; HOLD only.

Requires explicit operator root invocation. Creates only a temporary fixture.
Does not grant issuance, read real secrets, or execute real effects.
"""
import argparse
import json
import os
from pathlib import Path
import pwd
import sys
import tempfile

ROLES = ('issuer', 'supervisor', 'coordinator', 'attacker')


def identities(names):
    users = {role: pwd.getpwnam(names[role]) for role in ROLES}
    if len({user.pw_uid for user in users.values()}) != 4 or any(user.pw_uid == 0 for user in users.values()):
        raise ValueError('four distinct nonroot UIDs required')
    return users


def child_attempt(user, directory, fixture):
    """Attempt read/write/replace/link/traverse as a dropped-privilege child."""
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        result = {}
        try:
            os.setgroups([])
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
            for name, action in (
                ('read', lambda: fixture.read_bytes()),
                ('write', lambda: fixture.write_bytes(b'FORGED')),
                ('replace', lambda: (directory / 'replacement').replace(fixture)),
                ('link', lambda: os.link(fixture, directory / 'link')),
                ('traverse', lambda: list(directory.iterdir())),
            ):
                try:
                    action()
                    result[name] = 'ALLOWED'
                except PermissionError:
                    result[name] = 'DENIED'
                except OSError as exc:
                    result[name] = 'ERROR_' + str(exc.errno)
            result['uid'] = os.geteuid()
        except BaseException as exc:
            result['fatal'] = type(exc).__name__
        os.write(write_fd, json.dumps(result).encode())
        os.close(write_fd)
        os._exit(0)
    os.close(write_fd)
    chunks = []
    while True:
        data = os.read(read_fd, 4096)
        if not data:
            break
        chunks.append(data)
    os.close(read_fd)
    _, status = os.waitpid(pid, 0)
    if os.waitstatus_to_exitcode(status) != 0:
        raise RuntimeError('child failed')
    return json.loads(b''.join(chunks))


def run(users):
    with tempfile.TemporaryDirectory(prefix='ge04-q32-custody-') as tmp:
        root = Path(tmp)
        os.chmod(root, 0o711)
        directory = root / 'issuer-private'
        directory.mkdir(mode=0o700)
        os.chown(directory, users['issuer'].pw_uid, users['issuer'].pw_gid)
        fixture = directory / 'synthetic-authority.txt'
        fixture.write_text('SYNTHETIC_BINDING_ONLY\n')
        os.chown(fixture, users['issuer'].pw_uid, users['issuer'].pw_gid)
        fixture.chmod(0o600)
        (directory / 'replacement').write_text('FORGED')
        # Never run authorized issuer mutations against the negative-test fixture.
        results = {role: child_attempt(users[role], directory, fixture)
                   for role in ('supervisor', 'coordinator', 'attacker')}
        # Issuer positive access uses an independent disposable directory/fixture.
        issuer_dir = root / 'issuer-positive'
        issuer_dir.mkdir(mode=0o700)
        os.chown(issuer_dir, users['issuer'].pw_uid, users['issuer'].pw_gid)
        issuer_fixture = issuer_dir / 'synthetic-positive.txt'
        issuer_fixture.write_text('ISSUER_POSITIVE_ONLY\n')
        os.chown(issuer_fixture, users['issuer'].pw_uid, users['issuer'].pw_gid)
        issuer_fixture.chmod(0o600)
        (issuer_dir / 'replacement').write_text('FORGED')
        results['issuer'] = child_attempt(users['issuer'], issuer_dir, issuer_fixture)
        expected_denials = ('read', 'write', 'replace', 'link', 'traverse')
        negative = all(all(results[role].get(key) == 'DENIED' for key in expected_denials)
                       for role in ('supervisor', 'coordinator', 'attacker'))
        original = (fixture.read_text() == 'SYNTHETIC_BINDING_ONLY\n'
                    and not (directory / 'link').exists()
                    and (directory / 'replacement').read_text() == 'FORGED')
        issuer_positive = all(results['issuer'].get(key) == 'ALLOWED'
                              for key in ('read', 'write', 'replace', 'traverse'))
        return {'gate': 'GE04_Q32_CUSTODY_CROSS_UID', 'disposition': 'HOLD',
                'qualified_independent_issuance': False, 'real_effects_performed': 0,
                'negative_operations_denied': negative, 'fixture_unchanged': original,
                'issuer_positive_observed': issuer_positive,
                'results': results, 'uids': {role: user.pw_uid for role, user in users.items()},
                'limits': 'fixture_only_no_fd_delegation_acl_mount_namespace_or_authentication_proof'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    for role in ROLES:
        parser.add_argument('--' + role, required=True)
    args = parser.parse_args()
    if not args.isolated_test or os.geteuid() != 0 or sys.platform != 'linux':
        print(json.dumps({'gate': 'GE04_Q32_CUSTODY_CROSS_UID', 'disposition': 'HOLD',
                          'reason': 'operator root and isolated-test required'}))
        return 78
    try:
        result = run(identities(vars(args)))
        print(json.dumps(result, sort_keys=True))
        return 78  # A negative probe is not clearance.
    except (KeyError, ValueError, OSError, RuntimeError) as exc:
        print(json.dumps({'gate': 'GE04_Q32_CUSTODY_CROSS_UID', 'disposition': 'HOLD',
                          'reason': str(exc)}))
        return 78

if __name__ == '__main__':
    raise SystemExit(main())
