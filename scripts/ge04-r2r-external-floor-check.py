"""GE-04 R2R independent-floor consistency assessment, NOT authorization.

A floor outside the Proxmox guest can detect a reverted guest head only while
the ALiX-side floor/key are themselves trustworthy and cannot be rolled back.
This module never creates/advances a floor and never certifies provenance.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "ge04_r2r_receipt", _HERE / "ge04-r2p-external-witness-receipt.py")
_receipt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_receipt)
_HEX = re.compile(r"[a-f0-9]{64}")
_FLOOR_KEYS = {"schema", "witnessId", "publicKeySha256",
               "minimumRevision", "policySha256", "checkpointSha256",
               "trustStatus"}


def assess_floor(receipt, floor, *, public_key, challenge_nonce, boot_id):
    result = {"status": "blocked", "floorConsistent": False,
              "signatureVerified": False, "witnessAuthorityQualified": False,
              "rollbackResistant": False, "reasons": []}
    reasons = result["reasons"]
    try:
        if (type(floor) is not dict or set(floor) != _FLOOR_KEYS
                or floor["schema"] != "ge04-r2r-floor-v1"
                or floor["trustStatus"] != "operator-unverified"
                or type(floor["witnessId"]) is not str or not floor["witnessId"]
                or type(floor["minimumRevision"]) is not int
                or floor["minimumRevision"] <= 0
                or type(public_key) is not bytes or len(public_key) != 32):
            raise ValueError("floor schema or provenance invalid")
        for field in ("publicKeySha256", "policySha256", "checkpointSha256"):
            if type(floor[field]) is not str or not _HEX.fullmatch(floor[field]):
                raise ValueError("invalid floor digest")
        if hashlib.sha256(public_key).hexdigest() != floor["publicKeySha256"]:
            raise ValueError("signing public key differs from pinned floor key")
        response = _receipt.verify_witness_receipt(
            receipt, trusted_public_key=public_key,
            challenge_nonce=challenge_nonce, witness_id=floor["witnessId"],
            checkpoint_digest=floor["checkpointSha256"],
            policy_digest=floor["policySha256"],
            revision=floor["minimumRevision"],
            minimum_revision=floor["minimumRevision"], boot_id=boot_id)
        result["signatureVerified"] = response["signatureVerified"]
        if (response["signatureVerified"] and
                response["freshChallengeMatched"] and response["headMatched"]):
            result["floorConsistent"] = True
        else:
            reasons.append("signed head does not satisfy verifier-held exact floor")
    except (KeyError, ValueError, TypeError, OSError) as exc:
        reasons.append("untrusted floor: " + type(exc).__name__)
    reasons.append("floor source not independently authenticated or rollback-proof")
    return result


def read_floor(path):
    # Fixture parser only: no claims about owner or protected ancestry.
    # Never use a repo JSON path as production monotonic authority.
    return json.loads(Path(path).read_text())
