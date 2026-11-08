"""GE-04-R2P signed external-witness receipt verifier (qualification ONLY).

Target deployment: separately administered append-only revision witness outside
ALiX issuer/coordinator/worker control. The witness must protect its signing key
and monotonic head independently. A signed receipt alone DOES NOT prove that
the witness is honest, live, durable, or rollback-resistant.

No witness service or key is provisioned by this module. No policy updates,
recovery authorization, credential delivery, or worker admission.
"""
from __future__ import annotations

import json
import re
from typing import Any

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
except ImportError:
    class InvalidSignature(Exception):
        pass
    Ed25519PublicKey = None

_SCHEMA = "ge04-r2p-witness-v1"
_FIELDS = frozenset(("schema", "witnessId", "nonce", "revision",
                     "checkpointSha256", "policySha256", "bootId"))
_HEX = re.compile(r"[0-9a-f]{64}")
_REV = re.compile(r"[1-9][0-9]{0,17}")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def _failure(reason):
    return {"status": "blocked", "signatureVerified": False,
            "freshChallengeMatched": False, "headMatched": False,
            "witnessAuthorityQualified": False, "rollbackResistant": False,
            "reasons": [reason,
                        "no independently qualified external monotonic witness"]}


def verify_witness_receipt(receipt: dict, *, trusted_public_key: bytes,
                           challenge_nonce: str, witness_id: str,
                           checkpoint_digest: str, policy_digest: str,
                           revision: int, minimum_revision: int,
                           boot_id: str):
    """Verify a signed receipt against *independently supplied* expectations.

    This method never contacts a witness. expected revision and monotonic floor
    must originate from distinct, trusted custody; passing caller-controlled
    values or one local file cannot provide rollback protection. Output HOLD.
    """
    if Ed25519PublicKey is None:
        return _failure("Ed25519 verifier unavailable")
    try:
        if (type(receipt) is not dict or set(receipt) != {"payload", "signature"}
                or type(receipt["payload"]) is not dict
                or set(receipt["payload"]) != _FIELDS):
            raise ValueError("unknown witness receipt schema")
        body = receipt["payload"]
        if (body["schema"] != _SCHEMA or
                type(body["witnessId"]) is not str or not body["witnessId"] or
                type(body["nonce"]) is not str or not _HEX.fullmatch(body["nonce"]) or
                type(body["revision"]) is not str or not _REV.fullmatch(body["revision"]) or
                type(body["checkpointSha256"]) is not str or
                not _HEX.fullmatch(body["checkpointSha256"]) or
                type(body["policySha256"]) is not str or
                not _HEX.fullmatch(body["policySha256"]) or
                type(body["bootId"]) is not str or not body["bootId"] or
                type(receipt["signature"]) is not str or
                not re.fullmatch(r"[0-9a-f]{128}", receipt["signature"])):
            raise ValueError("invalid witness receipt fields")
        if (type(trusted_public_key) is not bytes or len(trusted_public_key) != 32
                or type(challenge_nonce) is not str or
                not _HEX.fullmatch(challenge_nonce) or
                type(checkpoint_digest) is not str or
                not _HEX.fullmatch(checkpoint_digest) or
                type(policy_digest) is not str or
                not _HEX.fullmatch(policy_digest) or
                type(witness_id) is not str or not witness_id or
                type(boot_id) is not str or not boot_id or
                type(revision) is not int or type(minimum_revision) is not int or
                revision < 1 or minimum_revision < 1):
            raise ValueError("invalid verifier trust inputs")
        key = Ed25519PublicKey.from_public_bytes(trusted_public_key)
        key.verify(bytes.fromhex(receipt["signature"]), canonical_bytes(body))
    except (ValueError, TypeError, KeyError, OverflowError, InvalidSignature) as exc:
        return _failure("witness signature or schema invalid: " +
                        type(exc).__name__)

    fresh = body["nonce"] == challenge_nonce and body["witnessId"] == witness_id
    head = (body["checkpointSha256"] == checkpoint_digest and
            body["policySha256"] == policy_digest and
            int(body["revision"]) == revision and
            revision >= minimum_revision and body["bootId"] == boot_id)
    reasons = ["external witness signature valid; authority remains unqualified"]
    if not fresh:
        reasons.append("stale response, wrong witness, or challenge replay")
    if not head:
        reasons.append("witness head, revision floor, policy or boot mismatch")
    reasons.append("external witness service and monotonic durability not qualified")
    return {"status": "blocked", "signatureVerified": True,
            "freshChallengeMatched": fresh, "headMatched": head,
            "witnessAuthorityQualified": False, "rollbackResistant": False,
            "reasons": reasons}
