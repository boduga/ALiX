#!/usr/bin/env python3
"""Opt-in GE-04 Q3.1 cross-UID qualification; no installation or authority.

Only an independently provisioned, disposable Linux test host with three
actual Linux identities can run this. The default entrypoint exits 78 unless
the operator explicitly supplies isolated test-only mode and identities.
Never installs accounts/services, changes permission outside its tempdir,
creates a signing key, or executes mutations. All IPC responses are DENIED.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import grp
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import sys
import tempfile
import time

SCRIPT = Path(__file__).with_name("ge04-q2-custody-fixture.py")
spec = importlib.util.spec_from_file_location("ge04_q2_fixture", SCRIPT)
assert spec and spec.loader
fixture_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_mod)


def fail(reason: str) -> int:
    print(json.dumps({"gate": "GE04_Q31", "disposition": "HOLD", "reason": reason}))
    return 78


def lookup_user(name: str) -> pwd.struct_passwd:
    record = pwd.getpwnam(name)
    if record.pw_uid == 0:
        raise ValueError("Root may not be a test participant")
    return record


def spawn_user(user: pwd.struct_passwd, group: int, args: list[str]):
    # Qualification launcher is the trusted *external* operator process.
    # No shell, no inherited file descriptors, and no model-provided command.
    return subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--worker", *args],
        pass_fds=(), close_fds=True, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        preexec_fn=lambda: (os.setgroups([]), os.setgid(group), os.setuid(user.pw_uid)),
    )


def worker(args: argparse.Namespace) -> int:
    if args.worker == "server":
        server = fixture_mod.DenyOnlyCustodyFixture(
            Path(args.directory), args.coordinator_uid,
            os.geteuid(), args.group_gid,
        )
        try:
            server.start()
            print(json.dumps({"ready": True, "uid": os.geteuid(), "pid": os.getpid()}), flush=True)
            matched = server.serve_once()
            print(json.dumps({"credential_match": matched}), flush=True)
        finally:
            server.close()
        return 0
    if args.worker == "client":
        with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as conn:
            conn.settimeout(3)
            conn.connect(str(Path(args.directory) / "deny-only.sock"))
            conn.sendall(b'{"approved":true,"uid":0}')
            reply = conn.recv(128)
        print(json.dumps({"uid": os.geteuid(), "pid": os.getpid(),
                          "reply": reply.decode("ascii")}), flush=True)
        return 0 if reply == fixture_mod.DENIED else 1
    return 78


def qualify(args: argparse.Namespace) -> int:
    if sys.platform != "linux" or os.geteuid() != 0:
        return fail("Requires externally operated isolated Linux root test launcher")
    try:
        supervisor = lookup_user(args.supervisor)
        coordinator = lookup_user(args.coordinator)
        attacker = lookup_user(args.attacker)
        group = grp.getgrnam(args.group)
        if len({supervisor.pw_uid, coordinator.pw_uid, attacker.pw_uid}) != 3:
            raise ValueError("Three distinct non-root UIDs required")
        if coordinator.pw_uid not in [pwd.getpwnam(member).pw_uid for member in group.gr_mem] and coordinator.pw_gid != group.gr_gid:
            raise ValueError("Coordinator must belong to the independently provisioned group")
        if attacker.pw_uid in [pwd.getpwnam(member).pw_uid for member in group.gr_mem] or attacker.pw_gid == group.gr_gid:
            raise ValueError("Attacker must not belong to transport group")
        with tempfile.TemporaryDirectory(prefix="alix-ge04-q31-") as temporary:
            parent = Path(temporary)
            os.chown(parent, supervisor.pw_uid, group.gr_gid)
            os.chmod(parent, 0o710)
            server = spawn_user(supervisor, group.gr_gid, ["server", "--directory", temporary,
                                 "--coordinator-uid", str(coordinator.pw_uid),
                                 "--group-gid", str(group.gr_gid)])
            try:
                # Socket readiness is checked by observation, not an untrusted server claim.
                sock = parent / "deny-only.sock"
                for _ in range(100):
                    if sock.exists() or server.poll() is not None:
                        break
                    time.sleep(0.02)
                if not sock.is_socket():
                    raise ValueError("Supervisor never opened socket")
                info = os.lstat(sock)
                if (info.st_uid != supervisor.pw_uid or info.st_gid != group.gr_gid
                        or stat.S_IMODE(info.st_mode) != 0o660):
                    raise ValueError("Socket ownership or permissions incorrect")
                hostile = spawn_user(attacker, attacker.pw_gid, ["client", "--directory", temporary])
                out_bad, err_bad = hostile.communicate(timeout=5)
                if hostile.returncode == 0:
                    raise ValueError("Unauthorized attacker connected")
                if "PermissionError" not in err_bad and "Permission denied" not in err_bad:
                    raise ValueError("Attacker rejection not proven to be socket access control")
                good = spawn_user(coordinator, group.gr_gid, ["client", "--directory", temporary])
                out_good, err_good = good.communicate(timeout=5)
                if good.returncode != 0:
                    raise ValueError("Coordinator IPC failed: " + err_good[:200])
                data = json.loads(out_good)
                if data.get("uid") != coordinator.pw_uid or data.get("reply") != fixture_mod.DENIED.decode("ascii"):
                    raise ValueError("Coordinator did not receive fixed DENIED")
                server_out, server_err = server.communicate(timeout=5)
                if server.returncode != 0 or not any(json.loads(line).get("credential_match") is True for line in server_out.splitlines()):
                    raise ValueError("Supervisor credential diagnostic failed: " + server_err[:200])
                evidence = {"gate": "GE04_Q31", "disposition": "HOLD",
                            "transport_observed": True, "qualified_independent_custody": False,
                            "supervisor_uid": supervisor.pw_uid, "coordinator_uid": coordinator.pw_uid,
                            "attacker_uid": attacker.pw_uid, "group_gid": group.gr_gid,
                            "socket_mode": "0660", "directory_mode": "0710",
                            "attacker_denied": True, "coordinator_denied": True,
                            "credential_match": True,
                            "remaining": ["fd delegation", "attempt binding", "protected release/runtime",
                                          "key custody", "last effect fence", "human signoff"]}
                print(json.dumps(evidence, sort_keys=True))
                return 0
            finally:
                if server.poll() is None:
                    server.terminate()
                try:
                    server.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.communicate()
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return fail(type(exc).__name__ + ": " + str(exc))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isolated-test", action="store_true")
    parser.add_argument("--worker", choices=["server", "client"])
    parser.add_argument("--supervisor")
    parser.add_argument("--coordinator")
    parser.add_argument("--attacker")
    parser.add_argument("--group")
    parser.add_argument("--directory")
    parser.add_argument("--coordinator-uid", type=int)
    parser.add_argument("--group-gid", type=int)
    args = parser.parse_args()
    if args.worker:
        if not args.directory or not args.directory.startswith("/tmp/alix-ge04-q31-"):
            return fail("Test worker requires isolated Q3.1 scratch path")
        if args.worker == "server" and (args.coordinator_uid is None or args.group_gid is None):
            return fail("Test worker needs pinned identity inputs")
        return worker(args)
    if not args.isolated_test or not all([args.supervisor, args.coordinator, args.attacker, args.group]):
        return fail("Not deployable; explicit isolated test inputs required")
    return qualify(args)


if __name__ == "__main__":
    raise SystemExit(main())
