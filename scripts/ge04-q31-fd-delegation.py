#!/usr/bin/env python3
"""GE-04 deny-only cross-UID connected-FD delegation probe. Disposable host only.

Root is required only to set three distinct test UIDs. The fixture never
issues approvals or mutations. Success demonstrates a credential attribution
limitation, NOT a security qualification. All verdicts remain HOLD.
"""
import argparse
import array
import importlib.util
import json
import os
from pathlib import Path
import pwd
import grp
import socket
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path(__file__).with_name('ge04-q2-custody-fixture.py')
spec = importlib.util.spec_from_file_location('ge04_q2_delegation', BASE)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def hold(reason):
    print(json.dumps({'gate': 'GE04_Q31_FD', 'disposition': 'HOLD', 'reason': reason}))
    return 78


def child(role, directory, channel, expected_uid, group_gid):
    if role == 'server':
        server = fixture.DenyOnlyCustodyFixture(Path(directory), expected_uid, os.geteuid(), group_gid)
        try:
            server.start()
            print(json.dumps({'ready': True, 'supervisor_uid': os.geteuid()}), flush=True)
            matched = server.serve_once()
            print(json.dumps({'credential_match': matched}), flush=True)
        finally:
            server.close()
        return 0
    with socket.socket(fileno=channel) as handoff:
        handoff.settimeout(4)
        if role == 'coordinator':
            with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as connected:
                connected.settimeout(4)
                connected.connect(str(Path(directory) / 'deny-only.sock'))
                handoff.sendmsg([b'connected'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [connected.fileno()]))])
                print(json.dumps({'connector_uid': os.geteuid(), 'delegated': True}), flush=True)
            return 0
        if role == 'attacker':
            data, controls, flags, _ = handoff.recvmsg(64, socket.CMSG_SPACE(array.array('i').itemsize))
            fds = array.array('i')
            for level, kind, payload in controls:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
            if data != b'connected' or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or len(fds) != 1:
                for fd in fds:
                    os.close(fd)
                raise ValueError('FD handoff invalid')
            with socket.socket(fileno=fds[0]) as connected:
                connected.settimeout(4)
                connected.sendall(b'{"approved":true,"uid":0}')
                response = connected.recv(128)
            print(json.dumps({'sender_uid': os.geteuid(), 'response': response.decode('ascii')}), flush=True)
            return 0 if response == fixture.DENIED else 1
    return 78


def launch(user, gid, args, pass_fds=()):
    def drop():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(user.pw_uid)
    return subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--worker', *args],
                            pass_fds=pass_fds, close_fds=True, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            preexec_fn=drop)


def run(args):
    if sys.platform != 'linux' or os.geteuid() != 0:
        return hold('isolated root launcher required')
    try:
        users = [pwd.getpwnam(x) for x in (args.supervisor, args.coordinator, args.attacker)]
        sup, coord, attack = users
        group = grp.getgrnam(args.group)
        if any(u.pw_uid == 0 for u in users) or len({u.pw_uid for u in users}) != 3:
            raise ValueError('three distinct nonroot UIDs required')
        members = {pwd.getpwnam(name).pw_uid for name in group.gr_mem}
        if not (coord.pw_uid in members or coord.pw_gid == group.gr_gid):
            raise ValueError('coordinator not in transport group')
        if attack.pw_uid in members or attack.pw_gid == group.gr_gid:
            raise ValueError('attacker belongs to transport group')
        with tempfile.TemporaryDirectory(prefix='alix-ge04-q31-') as tmp:
            parent = Path(tmp)
            os.chown(parent, sup.pw_uid, group.gr_gid)
            os.chmod(parent, 0o710)
            server = launch(sup, group.gr_gid, ['server', '--directory', tmp, '--expected-uid', str(coord.pw_uid), '--group-gid', str(group.gr_gid)])
            processes = [server]
            try:
                sockpath = parent / 'deny-only.sock'
                for _ in range(150):
                    if sockpath.is_socket() or server.poll() is not None:
                        break
                    time.sleep(.02)
                if not sockpath.is_socket():
                    raise ValueError('supervisor socket not ready')
                st = os.lstat(sockpath)
                if (st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)) != (sup.pw_uid, group.gr_gid, 0o660):
                    raise ValueError('socket custody mismatch')
                a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
                try:
                    attacker = launch(attack, attack.pw_gid, ['attacker', '--directory', tmp, '--channel', str(b.fileno())], (b.fileno(),))
                    processes.append(attacker)
                    coordinator = launch(coord, group.gr_gid, ['coordinator', '--directory', tmp, '--channel', str(a.fileno())], (a.fileno(),))
                    processes.append(coordinator)
                finally:
                    a.close()
                    b.close()
                coord_out, coord_err = coordinator.communicate(timeout=8)
                attack_out, attack_err = attacker.communicate(timeout=8)
                server_out, server_err = server.communicate(timeout=8)
                if any(p.returncode != 0 for p in processes):
                    raise ValueError('child failed: ' + repr([coord_err[:160], attack_err[:160], server_err[:160]]))
                sent = json.loads(attack_out)
                connected = json.loads(coord_out)
                verdicts = [json.loads(line) for line in server_out.splitlines()]
                match = any(v.get('credential_match') is True for v in verdicts)
                if not (match and sent.get('sender_uid') == attack.pw_uid and connected.get('connector_uid') == coord.pw_uid and sent.get('response') == fixture.DENIED.decode('ascii')):
                    raise ValueError('delegation evidence mismatch')
                print(json.dumps({'gate': 'GE04_Q31_FD', 'disposition': 'HOLD', 'cross_uid_delegation_observed': True,
                                  'original_connector_uid': coord.pw_uid, 'actual_sender_uid': attack.pw_uid,
                                  'supervisor_uid': sup.pw_uid, 'kernel_credential_match': match,
                                  'response_denied': True, 'qualified_independent_custody': False}, sort_keys=True))
                return 0
            finally:
                for p in processes:
                    if p.poll() is None:
                        p.kill()
                    p.communicate()
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        return hold(type(error).__name__ + ': ' + str(error))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--isolated-test', action='store_true')
    parser.add_argument('--worker', choices=['server', 'coordinator', 'attacker'])
    for name in ('supervisor', 'coordinator', 'attacker', 'group', 'directory'):
        parser.add_argument('--' + name)
    parser.add_argument('--channel', type=int)
    parser.add_argument('--expected-uid', type=int)
    parser.add_argument('--group-gid', type=int)
    args = parser.parse_args()
    if args.worker:
        if not args.directory or not args.directory.startswith('/tmp/alix-ge04-q31-'):
            return hold('worker outside isolated scratch directory')
        if args.worker == 'server' and (args.expected_uid is None or args.group_gid is None):
            return hold('server identity inputs missing')
        if args.worker != 'server' and args.channel is None:
            return hold('handoff channel missing')
        return child(args.worker, args.directory, args.channel, args.expected_uid, args.group_gid)
    if not args.isolated_test or not all((args.supervisor, args.coordinator, args.attacker, args.group)):
        return hold('explicit test identities required')
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
