"""GE-04-R2Q cross-host live challenge probe via SSH local port forwarding.

Qualification only; expected key and head are locally pinned from an
operator-unverified snapshot. This DOES NOT establish independent authority.
"""
from __future__ import annotations
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import tempfile
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ge04_r2p", HERE / "ge04-r2p-external-witness-receipt.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
challenge_spec = importlib.util.spec_from_file_location(
    "ge04_r2r_challenge", HERE / "ge04-r2r-challenge-custody.py")
challenge_module = importlib.util.module_from_spec(challenge_spec)
challenge_spec.loader.exec_module(challenge_module)
floor_spec = importlib.util.spec_from_file_location(
    "ge04_r2r_floor", HERE / "ge04-r2r-external-floor-check.py")
floor_module = importlib.util.module_from_spec(floor_spec)
floor_spec.loader.exec_module(floor_module)

HOST = "ubuntu@10.1.1.13"
LOCAL_PORT = 18842


def load_qualification_pin(path):
    """Untrusted operator snapshot, NOT a production trust anchor.

    Only syntactic validation is performed. Public key provenance requires
    an out-of-band security review; no authority can be gained from this.
    """
    pin = json.loads(Path(path).read_text())
    expected = {"schema", "witnessId", "host", "publicKeyHex",
                "revision", "policySha256", "checkpointSha256",
                "trustStatus", "authorization"}
    def digest(s):
        return type(s) is str and len(s) == 64 and all(c in "0123456789abcdef" for c in s)
    if (type(pin) is not dict or set(pin) != expected
            or pin["schema"] != "ge04-r2r-qualification-pin-v1"
            or pin["trustStatus"] != "unverified-operator-pin"
            or pin["authorization"] is not False
            or pin["host"] != "10.1.1.13"
            or pin["witnessId"] != "alix-ge04-r2q-qualifier"
            or type(pin["revision"]) is not int or pin["revision"] < 1
            or not digest(pin["publicKeyHex"])
            or not digest(pin["policySha256"])
            or not digest(pin["checkpointSha256"])):
        raise ValueError("untrusted qualification pin manifest")
    return pin


def run():
    pin = load_qualification_pin(HERE.parent / "docs/audits/evidence/ge04/r2r-qualification-witness-pin.json")
    pub = bytes.fromhex(pin["publicKeyHex"])
    proc = subprocess.Popen(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
         "-o", "ExitOnForwardFailure=yes",
         "-L", f"127.0.0.1:{LOCAL_PORT}:127.0.0.1:18841",
         "-N", HOST],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(60):
            if proc.poll() is not None:
                raise RuntimeError("SSH tunnel exited")
            try:
                with socket.create_connection(("127.0.0.1", LOCAL_PORT), timeout=.5):
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("tunnel listener missing")
        with urlopen(f"http://127.0.0.1:{LOCAL_PORT}/health", timeout=3) as r:
            health = json.load(r)
        assert health["authorization"] is False
        # Isolation-only qualification DB; persisted within the probe's
        # lifecycle, no machine-global state or second ALiX approval store.
        with tempfile.TemporaryDirectory(prefix="ge04-r2r-live-") as scratch:
            Path(scratch).chmod(0o700)
            db_path = challenge_module.create_custody(
                Path(scratch) / "challenge.sqlite")
            custody = challenge_module.ChallengeCustody(db_path)
            try:
                nonce = custody.issue()  # durable BEFORE network request
                boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
                body = json.dumps({"nonce": nonce, "bootId": boot}).encode()
                with urlopen(Request(f"http://127.0.0.1:{LOCAL_PORT}/challenge",
                                     data=body, headers={"Content-Type": "application/json"}),
                             timeout=4) as r:
                    receipt = json.load(r)
                # Consume regardless of receipt validity; no retry can reuse it.
                consumed = custody.consume(nonce)
                if not consumed:
                    raise ValueError("unissued or already-consumed witness nonce")
                result = verify.verify_witness_receipt(
                    receipt, trusted_public_key=pub, challenge_nonce=nonce,
                    witness_id=pin["witnessId"],
                    policy_digest=pin["policySha256"],
                    checkpoint_digest=pin["checkpointSha256"],
                    revision=pin["revision"],
                    minimum_revision=pin["revision"], boot_id=boot)
                replay_blocked = not custody.consume(nonce)
                assert (result["signatureVerified"] and result["freshChallengeMatched"]
                        and result["headMatched"] and result["status"] == "blocked"
                        and not result["witnessAuthorityQualified"]
                        and not result["rollbackResistant"])
                assert replay_blocked
                # Deliberately inject an ALiX-side future floor; this proves
                # that a signed older VM head is rejected without changing
                # witness state or claiming a real independent trust anchor.
                hypothetical_floor = {
                    "schema": "ge04-r2r-floor-v1",
                    "witnessId": pin["witnessId"],
                    "publicKeySha256": hashlib.sha256(pub).hexdigest(),
                    "minimumRevision": pin["revision"] + 1,
                    "policySha256": pin["policySha256"],
                    "checkpointSha256": pin["checkpointSha256"],
                    "trustStatus": "operator-unverified",
                }
                rollback = floor_module.assess_floor(
                    receipt, hypothetical_floor, public_key=pub,
                    challenge_nonce=nonce, boot_id=boot)
                rollback_blocked = (
                    rollback["signatureVerified"] and
                    not rollback["floorConsistent"] and
                    rollback["status"] == "blocked")
                assert rollback_blocked
            finally:
                custody.close()
        return {"status":"blocked", "crossHostChallengeVerified":True,
                "replayMismatchBlocked":replay_blocked,
                "durableSingleUseChallengeVerified":True,
                "hypotheticalHigherFloorBlocked":rollback_blocked,
                "witnessRevision":receipt["payload"]["revision"],
                "witnessAuthorityQualified":False, "rollbackResistant":False,
                "publicKeyProvenance":"locally pinned, operator provenance UNVERIFIED",
                "transport":"SSH loopback tunnel"}
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()


if __name__ == "__main__":
    try:
        print(json.dumps(run(), sort_keys=True))
    except Exception as exc:
        print(json.dumps({"status": "blocked", "crossHostChallengeVerified": False,
                          "reason": type(exc).__name__ + ": " + str(exc)}))
        raise SystemExit(78)
