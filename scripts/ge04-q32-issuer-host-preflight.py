#!/usr/bin/env python3
"""Read-only Linux host boundary observations; always HOLD (exit 78).

Does not request sudo, enumerate private secrets, or grant authorization.
"""
import argparse
import json
import os
import pwd
import grp
import stat
import sys
from pathlib import Path

GATE = 'GE04_Q32_ISSUER_HOST_PREFLIGHT'


def inspect(names, paths):
    reasons = []
    identities = {}
    for role, name in names.items():
        try:
            user = pwd.getpwnam(name)
            groups = sorted(g.gr_gid for g in grp.getgrall() if name in g.gr_mem)
            groups = sorted(set(groups + [user.pw_gid]))
            identities[role] = {'uid': user.pw_uid, 'gid': user.pw_gid, 'groups': groups}
            if user.pw_uid == 0:
                reasons.append(role + ':root_uid')
        except KeyError:
            reasons.append(role + ':missing_identity')
    if len(identities) != 4 or len({v['uid'] for v in identities.values()}) != 4:
        reasons.append('identities_not_four_distinct')
    if len(identities) == 4:
        issuer = identities['issuer']
        for role in ('supervisor', 'coordinator', 'attacker'):
            if issuer['gid'] in identities[role]['groups']:
                reasons.append(role + ':issuer_primary_group_membership')
    observations = {}
    for label, path in paths.items():
        p = Path(path)
        if not p.is_absolute():
            reasons.append(label + ':nonabsolute_path')
            continue
        components = [p, *list(p.parents)]
        info = []
        for component in components:
            try:
                st = os.lstat(component)
                mode = stat.S_IMODE(st.st_mode)
                info.append({'path': str(component), 'uid': st.st_uid, 'gid': st.st_gid,
                             'mode': oct(mode), 'symlink': stat.S_ISLNK(st.st_mode),
                             'device': st.st_dev})
                if stat.S_ISLNK(st.st_mode):
                    reasons.append(label + ':symlink_component')
                if mode & 0o002:
                    reasons.append(label + ':world_writable_component')
            except OSError:
                reasons.append(label + ':unreadable_component')
        observations[label] = info
    return {'gate': GATE, 'disposition': 'HOLD',
            'qualified_independent_issuance': False, 'identities': identities,
            'path_observations': observations, 'warnings': sorted(set(reasons)),
            'limits': 'snapshot_only_no_acl_sudo_mount_or_effect_proof'}


def main():
    p = argparse.ArgumentParser()
    for role in ('issuer', 'supervisor', 'coordinator', 'attacker'):
        p.add_argument('--' + role, required=True)
    p.add_argument('--inspect-path', action='append', default=[], metavar='ABSOLUTE_PATH')
    args = p.parse_args()
    result = inspect({role: getattr(args, role) for role in
                      ('issuer', 'supervisor', 'coordinator', 'attacker')},
                     {'path_' + str(i): path for i, path in enumerate(args.inspect_path)})
    print(json.dumps(result, sort_keys=True))
    return 78


if __name__ == '__main__':
    sys.exit(main())
