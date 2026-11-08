"""GE-04 R2S offline public enrollment evidence verifier (qualification ONLY).

Does NOT enroll keys, create secrets, authenticate host ownership, or provision
an immutable counter. Two distinct independently pre-pinned reviewer keys sign
the exact public enrollment claim. The holder of both keys may forge approval;
no signature proves actual organizational or administrative independence.
"""
from __future__ import annotations

import hashlib
import json
import re

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

SCHEMA = "ge04-r2s-enrollment-v1"
DOMAIN = b"ALIX-GE04-R2S-ENROLLMENT-V1\0"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
HEX128 = re.compile(r"[0-9a-f]{128}\Z")
IDENTITY = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
CLAIM_FIELDS = frozenset({
    "schema", "serviceId", "anchorId", "epoch", "anchorSignerPublicKeyHex",
    "witnessSignerSha256", "floorRevision", "floorHeadSha256",
    "anchorOperatorId", "witnessOperatorId", "securityReviewId",
})
ATTEST_FIELDS = frozenset({"principalId", "signature"})
ENVELOPE_FIELDS = frozenset({"claim", "attestations"})
LIMIT = 8192


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def _assert_claim(claim: object) -> None:
    if type(claim) is not dict or set(claim) != CLAIM_FIELDS or claim["schema"] != SCHEMA:
        raise ValueError("invalid enrollment claim schema")
    for name in ("serviceId", "anchorId", "epoch", "anchorOperatorId",
                 "witnessOperatorId", "securityReviewId"):
        if type(claim[name]) is not str or IDENTITY.fullmatch(claim[name]) is None:
            raise ValueError("invalid enrollment identity")
    if len({claim["anchorOperatorId"], claim["witnessOperatorId"],
            claim["securityReviewId"]}) != 3:
        raise ValueError("claimed operator separation missing")
    for field in ("anchorSignerPublicKeyHex", "witnessSignerSha256", "floorHeadSha256"):
        if type(claim[field]) is not str or HEX64.fullmatch(claim[field]) is None:
            raise ValueError("invalid enrollment digest/key")
    if type(claim["floorRevision"]) is not int or not 0 <= claim["floorRevision"] <= 2**53-1:
        raise ValueError("invalid floor revision")
    if (claim["floorRevision"] == 0) != (claim["floorHeadSha256"] == "0"*64):
        raise ValueError("invalid initial floor binding")


def assess_enrollment(envelope: object, *, pinned_reviewer_keys: dict,
                      expected_anchor_id: str, expected_epoch: str,
                      minimum_floor: dict) -> dict:
    """Never return trust-qualified or allow. Pins/floor supplied by the caller
    MUST be sourced independently, but this function cannot verify provenance.
    """
    result = {"status": "blocked", "securityHoldActive": True,
              "enrollmentSignaturesConsistent": False,
              "protectedFloorConsistent": False,
              "independentAdministrationQualified": False,
              "rollbackResistant": False, "authorizationGranted": False,
              "reasons": []}
    try:
        if type(envelope) is not dict or set(envelope) != ENVELOPE_FIELDS:
            raise ValueError("invalid enrollment envelope")
        if len(_canonical(envelope)) > LIMIT:
            raise ValueError("enrollment too large")
        claim = envelope["claim"]
        _assert_claim(claim)
        if claim["anchorId"] != expected_anchor_id or claim["epoch"] != expected_epoch:
            raise ValueError("unexpected anchor identity or epoch")
        att = envelope["attestations"]
        if type(att) is not list or len(att) != 2:
            raise ValueError("two attesters required")
        if (type(pinned_reviewer_keys) is not dict or
                set(pinned_reviewer_keys) != {"anchor-operator", "security-reviewer"}):
            raise ValueError("independent reviewer keys absent")
        canonical = DOMAIN + _canonical(claim)
        seen = set()
        pubs = set()
        for entry in att:
            if type(entry) is not dict or set(entry) != ATTEST_FIELDS:
                raise ValueError("invalid attestation")
            principal = entry["principalId"]
            signature = entry["signature"]
            if (type(principal) is not str or principal not in pinned_reviewer_keys or
                    type(signature) is not str or HEX128.fullmatch(signature) is None or
                    principal in seen):
                raise ValueError("unknown or duplicate attester")
            pub = pinned_reviewer_keys[principal]
            if type(pub) is not bytes or len(pub) != 32 or pub in pubs:
                raise ValueError("missing or reused reviewer key")
            seen.add(principal)
            pubs.add(pub)
            try:
                Ed25519PublicKey.from_public_bytes(pub).verify(
                    bytes.fromhex(signature), canonical)
            except Exception as exc:
                raise ValueError("invalid operator signature") from exc
        if seen != {"anchor-operator", "security-reviewer"}:
            raise ValueError("missing required operator role")
        result["enrollmentSignaturesConsistent"] = True
        if type(minimum_floor) is not dict or set(minimum_floor) != {
            "anchorId", "epoch", "revision", "headSha256"}:
            raise ValueError("untrusted floor schema")
        rev = minimum_floor["revision"]
        dig = minimum_floor["headSha256"]
        if (minimum_floor["anchorId"] != claim["anchorId"] or
                minimum_floor["epoch"] != claim["epoch"] or
                type(rev) is not int or not 0 <= rev <= 2**53-1 or
                type(dig) is not str or HEX64.fullmatch(dig) is None or
                (rev == 0) != (dig == "0"*64)):
            raise ValueError("invalid independent reference floor")
        if (claim["floorRevision"] != rev or claim["floorHeadSha256"] != dig):
            raise ValueError("signed enrolled floor differs from supplied reference")
        result["protectedFloorConsistent"] = True
        result["reasons"].append(
            "signed enrollment consistent with supplied reviewer pins and floor only")
    except (TypeError, ValueError, KeyError, OverflowError) as exc:
        result["reasons"].append("enrollment blocked: " + str(exc))
    result["reasons"].append(
        "external operator provenance, key custody and rollback protection unqualified")
    return result


def inspect_json_bytes(raw: bytes, *, maximum: int = LIMIT) -> object:
    """Parse without duplicate keys, rejecting oversize/NaN/unknown encodings."""
    if type(raw) is not bytes or not 1 <= len(raw) <= maximum:
        raise ValueError("invalid enrollment byte length")
    def pairs(items: list) -> dict:
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError("duplicate JSON field")
            out[key] = value
        return out
    def reject(value: str) -> None:
        raise ValueError("non-finite number")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=reject)
