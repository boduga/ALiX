#!/usr/bin/env python3
"""Disposable separate-process effect boundary. NOT an authority or ALiX backend.

The child owns its private scratch descriptor and performs an internally scripted
single-byte syscall. External SOCK_SEQPACKET requests are always denied, even
when carrying apparent credentials, claims, or file descriptors. The parent
cannot request an effect. Revocation and the syscall share a child-local lock.
No production paths, credentials, or authorization are involved.
"""
import array
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

HOLD = {"gate": "GE04_Q32_PROCESS_EFFECT_PROBE", "disposition": "HOLD",
        "qualified_effect_authority": False, "production_effects_performed": 0}


def child_main(sock_fd, scenario):
    sock = socket.socket(fileno=sock_fd)
    lock = threading.Lock()
    entered = threading.Event()
    release = threading.Event()
    revoked = threading.Event()
    state = {"active": True, "effects": 0}
    scratch = tempfile.TemporaryDirectory(prefix="ge04-process-effect-child-")
    target = Path(scratch.name) / "effect.bin"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
    try:
        def effect():
            with lock:
                if not state["active"]:
                    return
                entered.set()
                if not release.wait(3):
                    return
                # The same lock covers the actual syscall, not merely a journal record.
                count = os.write(fd, b"X")
                if count == 1:
                    state["effects"] += 1

        def revoke():
            with lock:
                state["active"] = False
                revoked.set()

        if scenario == "revoke-first":
            revoke()
            release.set()
            effect()
        elif scenario == "effect-first":
            writer = threading.Thread(target=effect)
            writer.start()
            if not entered.wait(3):
                raise RuntimeError("effect did not enter")
            revoker = threading.Thread(target=revoke)
            revoker.start()
            # Revocation cannot finish while effect holds the syscall lock.
            premature = revoked.wait(0.05)
            release.set()
            writer.join(3)
            revoker.join(3)
            if premature or writer.is_alive() or revoker.is_alive():
                raise RuntimeError("serialization violated")
            effect()  # post-revocation effects denied
        else:
            raise ValueError("unsupported scenario")

        # Untrusted IPC cannot initiate any effect. Close received SCM_RIGHTS.
        sock.settimeout(3)
        data, anc, flags, _ = sock.recvmsg(4096, socket.CMSG_SPACE(64),
                                          getattr(socket, "MSG_CMSG_CLOEXEC", 0))
        for level, kind, payload in anc:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                fds = array.array("i")
                fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
                for received in fds:
                    os.close(received)
        response = {**HOLD, "reason": "UNTRUSTED_IPC_DENIED",
                    "scratch_effects": state["effects"],
                    "scratch_bytes": target.read_bytes().decode("ascii"),
                    "ancillary_rejected": bool(anc),
                    "truncated": bool(flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC))}
        sock.send(json.dumps(response).encode())
    finally:
        os.close(fd)
        sock.close()
        scratch.cleanup()


def run_scenario(scenario, *, pass_fd=False):
    if scenario not in ("effect-first", "revoke-first"):
        raise ValueError("unsupported scenario")
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    try:
        proc = subprocess.Popen([sys.executable, "-B", __file__, "--child",
                                 str(child.fileno()), scenario],
                                pass_fds=(child.fileno(),), close_fds=True,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        child.close()
        try:
            request = json.dumps({"operation": "write", "nonce": "forged",
                                  "authorized": True, "audience": "supervisor"}).encode()
            if pass_fd:
                fd = os.open(os.devnull, os.O_RDONLY)
                try:
                    parent.sendmsg([request], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                                 array.array("i", [fd]))])
                finally:
                    os.close(fd)
            else:
                parent.send(request)
            parent.settimeout(5)
            result = json.loads(parent.recv(4096))
            proc.wait(timeout=5)
            if proc.returncode != 0:
                raise RuntimeError("child failed")
            return result
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    finally:
        parent.close()
        child.close()

def main(argv):
    if len(argv) == 3 and argv[0] == "--child":
        child_main(int(argv[1]), argv[2])
        return 0
    print(json.dumps(HOLD))
    return 78


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
