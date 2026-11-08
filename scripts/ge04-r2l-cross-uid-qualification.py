"""GE-04-R2L disposable-host real cross-UID AF_UNIX denial qualification.

NO production activation. Run only with --isolated-test under root in the
dedicated qualification VM. This creates no users and sends no credentials.
All verifier outcomes remain blocked. Three ephemeral role UIDs are used.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROLES = {"verifier": 62041, "issuer": 62042, "attacker": 62043}
GID = ROLES
DENIED = "DENIED GE04_SECURITY_HOLD"


def gate():
    spec = importlib.util.spec_from_file_location(
        "ge04_r2k_gate", HERE / "ge04-r2k-peercred-gate.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("R2K gate is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def drop(role):
    uid = ROLES[role]
    def perform():
        os.setgroups([])
        os.setgid(uid)
        os.setuid(uid)
    return perform


def own_claim():
    mod = gate()
    ticks = mod._proc_generation(os.getpid())
    if not ticks:
        raise RuntimeError("process generation not readable")
    return {"schema": "ge04-r2k-v1", "pid": os.getpid(),
            "uid": os.getuid(), "gid": os.getgid(),
            "startTimeTicks": ticks,
            "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}


def serve(path):
    mod = gate()
    results = []
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.settimeout(6)
        listener.bind(path)
        os.chmod(path, 0o777)  # Qualification-only: allow attacker connection.
        listener.listen(3)
        for _ in range(3):
            conn, _ = listener.accept()
            with conn:
                conn.settimeout(4)
                data = conn.recv(4096)
                try:
                    claim = json.loads(data.decode("utf-8"))
                except (UnicodeError, json.JSONDecodeError):
                    claim = None
                response = mod.inspect_peer_credentials(
                    conn, claim, ROLES["issuer"],
                    forbidden_uids=(ROLES["attacker"],))
                results.append(response)
                conn.sendall(b"DENIED")
    print(json.dumps({"role": "verifier", "uid": os.geteuid(),
                      "results": results}, sort_keys=True), flush=True)


def client(path, forged=False):
    claim = own_claim()
    if forged:
        if os.getuid() == ROLES["issuer"]:
            # A real issuer UID can still forge process identity in its payload.
            claim["pid"] = os.getpid() + 1
        else:
            # An attacker from a different UID falsely claims to be the issuer.
            claim["uid"] = ROLES["issuer"]
            claim["gid"] = ROLES["issuer"]
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(4)
        s.connect(path)
        s.sendall(json.dumps(claim).encode("utf-8"))
        reply = s.recv(64)
        if reply != b"DENIED":
            raise RuntimeError("missing explicit denial")
    print(json.dumps({"uid": os.geteuid(), "claimedUid": claim["uid"],
                      "denied": True, "pid": os.getpid()}), flush=True)


def isolated_test():
    if sys.platform != "linux" or os.geteuid() != 0:
        raise RuntimeError("root operator on isolated Linux guest required")
    import pwd
    if any(uid == 0 or any(e.pw_uid == uid for e in pwd.getpwall())
           for uid in ROLES.values()):
        raise RuntimeError("reserved test UID already exists")
    with tempfile.TemporaryDirectory(prefix="ge04-r2l-") as directory:
        os.chown(directory, ROLES["verifier"], ROLES["verifier"])
        os.chmod(directory, 0o711)
        sock = str(Path(directory) / "peer.sock")
        args = [sys.executable, "-B", str(Path(__file__).resolve())]
        service = subprocess.Popen(args + ["--service", sock],
                                   preexec_fn=drop("verifier"),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True)
        client_results = []
        try:
            for _ in range(200):
                if os.path.exists(sock) or service.poll() is not None:
                    break
                time.sleep(0.02)
            if not os.path.exists(sock):
                raise RuntimeError("verifier did not bind")
            for role, forged in (("issuer", False),
                                 ("attacker", True),
                                 ("issuer", True)):
                proc = subprocess.run(args + ["--client", sock,
                                       "--forged" if forged else "--genuine"],
                                      preexec_fn=drop(role),
                                      capture_output=True, text=True, timeout=5)
                if proc.returncode != 0:
                    raise RuntimeError("client failed: " + proc.stderr[-500:])
                client_results.append(json.loads(proc.stdout))
            stdout, stderr = service.communicate(timeout=8)
            if service.returncode != 0:
                raise RuntimeError("verifier failed: " + stderr[-500:])
            reply = json.loads(stdout)
            checked = reply["results"]
            passed = (len(checked) == 3 and reply["uid"] == ROLES["verifier"]
                      and all(x["status"] == "blocked" for x in checked)
                      and checked[0]["kernelPeer"]["uid"] == ROLES["issuer"]
                      and checked[0]["peerIdentityConsistent"] is True
                      and checked[1]["kernelPeer"]["uid"] == ROLES["attacker"]
                      and checked[1]["peerIdentityConsistent"] is False
                      and checked[2]["kernelPeer"]["uid"] == ROLES["issuer"]
                      and checked[2]["peerIdentityConsistent"] is False
                      and all(x["denied"] for x in client_results))
            return {"gate": "GE04_R2L_REAL_CROSS_UID", "disposition": "HOLD",
                    "qualifiedForRecovery": False, "passed": passed,
                    "roleUids": ROLES, "verifier": reply,
                    "clients": client_results, "credentialDelivery": False}
        finally:
            if service.poll() is None:
                service.kill()
                service.communicate(timeout=4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--isolated-test", action="store_true")
    parser.add_argument("--service", metavar="PATH")
    parser.add_argument("--client", metavar="PATH")
    parser.add_argument("--forged", action="store_true")
    parser.add_argument("--genuine", action="store_true")
    args = parser.parse_args()
    if args.service:
        serve(args.service)
        return 0
    if args.client:
        client(args.client, forged=args.forged)
        return 0
    if not args.isolated_test:
        print(json.dumps({"gate": "GE04_R2L_REAL_CROSS_UID",
                          "disposition": "HOLD", "reason": "isolated-test required"}))
        return 78
    try:
        result = isolated_test()
        print(json.dumps(result, sort_keys=True))
        return 0 if result["passed"] else 78
    except Exception as exc:
        print(json.dumps({"gate": "GE04_R2L_REAL_CROSS_UID",
                          "disposition": "HOLD", "passed": False,
                          "reason": type(exc).__name__ + ": " + str(exc)}))
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
