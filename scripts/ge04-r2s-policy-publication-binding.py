"""GE-04 R2S policy-publication binding, *qualification only*.

Verifies a pinned ALiX policy-publication signing key and exact linkage of a
canonical policy snapshot, proposed anchor head and two-role request. It does
NOT establish who controls the key, real policy approval, protected storage,
worker authorization, or permission to call the anchor mutator.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE = Path(__file__).resolve().parent

def _load(filename, name):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod

_anchor = _load("ge04-r2s-anchor-protocol.py", "ge04_publication_anchor")
_roles = _load("ge04-r2s-mtls-dual-role-binding.py", "ge04_publication_roles")

SCHEMA = "ge04-r2s-policy-publication-v1"
DOMAIN = b"ALIX-GE04-R2S-POLICY-PUBLICATION-V1\0"
HEX128 = re.compile(r"[a-f0-9]{128}\Z")
ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
CLAIM_KEYS = frozenset({
    "schema", "publisherPrincipalId", "policyAuthorityId", "requestId",
    "anchorId", "epoch", "policyRevision", "policySha256",
    "checkpointSha256", "anchorHeadSha256",
    "expectedRevision", "expectedHeadSha256",
})
ENVELOPE_KEYS = frozenset({"claim", "signature"})
MAX_POLICY = 65536
MAX_ENVELOPE = 8192


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def _blocked(reason, **extra):
    return {"status": "blocked", "securityHoldActive": True,
            "authorizationGranted": False, "rollbackResistant": False,
            "policyAuthorityQualified": False, "publicationConsistent": False,
            "reason": reason, **extra}


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_nonfinite(value):
    raise ValueError("nonfinite JSON value")


def read_json(raw, *, maximum):
    if type(raw) is not bytes or not 1 <= len(raw) <= maximum:
        raise ValueError("invalid JSON byte size")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
                      parse_constant=_reject_nonfinite)


def policy_sha256(policy):
    """SHA-256 of the exact canonical *policy document*; not a signature."""
    return hashlib.sha256(canonical(policy)).hexdigest()


def assess_publication(*, policy_bytes, envelope_bytes, head,
                       two_role_request_bytes, pinned_authority_key,
                       expected_authority_id, expected_publisher_principal,
                       expected_anchor_id, expected_epoch,
                       minimum_revision, minimum_head_sha256):
    """Everything, including key pins and floors, is caller-provided test data."""
    try:
        policy = read_json(policy_bytes, maximum=MAX_POLICY)
        if type(policy) is not dict or not policy:
            raise ValueError("invalid policy document")
        # Strict JSON parse prevents alternate signed interpretations.
        envelope = read_json(envelope_bytes, maximum=MAX_ENVELOPE)
        if type(envelope) is not dict or set(envelope) != ENVELOPE_KEYS:
            raise ValueError("invalid publication envelope")
        claim = envelope["claim"]
        sig = envelope["signature"]
        if (type(claim) is not dict or set(claim) != CLAIM_KEYS or
                claim["schema"] != SCHEMA or type(sig) is not str or
                HEX128.fullmatch(sig) is None):
            raise ValueError("invalid publication claim/signature")
        for field in ("publisherPrincipalId", "policyAuthorityId", "requestId",
                      "anchorId", "epoch"):
            if type(claim[field]) is not str or ID.fullmatch(claim[field]) is None:
                raise ValueError("malformed publication identity")
        if type(claim["policyRevision"]) is not int or claim["policyRevision"] < 1:
            raise ValueError("invalid ALiX policy revision")
        for field in ("policySha256", "checkpointSha256", "anchorHeadSha256",
                      "expectedHeadSha256"):
            if type(claim[field]) is not str or _anchor.HEX.fullmatch(claim[field]) is None:
                raise ValueError("invalid publication digest")
        if (type(claim["expectedRevision"]) is not int
                or claim["expectedRevision"] < 0
                or claim["expectedRevision"] >= _anchor.MAX_REVISION):
            raise ValueError("invalid expected revision")
        if (type(minimum_revision) is not int or
                type(minimum_head_sha256) is not str or
                _anchor.HEX.fullmatch(minimum_head_sha256) is None or
                claim["expectedRevision"] != minimum_revision or
                claim["expectedHeadSha256"] != minimum_head_sha256):
            raise ValueError("floor differs from publication")
        if (type(pinned_authority_key) is not bytes or
                len(pinned_authority_key) != 32 or
                type(expected_authority_id) is not str or
                claim["policyAuthorityId"] != expected_authority_id or
                claim["publisherPrincipalId"] != expected_publisher_principal):
            raise ValueError("untrusted policy authority or publisher")
        if (claim["anchorId"] != expected_anchor_id or
                claim["epoch"] != expected_epoch):
            raise ValueError("wrong target anchor/epoch")
        try:
            Ed25519PublicKey.from_public_bytes(pinned_authority_key).verify(
                bytes.fromhex(sig), DOMAIN + canonical(claim))
        except (InvalidSignature, ValueError) as exc:
            raise ValueError("policy publication signature invalid") from exc
        if (type(policy.get("policyRevision")) is not int or
                policy["policyRevision"] != claim["policyRevision"]):
            raise ValueError("policy revision differs from signed publication")
        if claim["policySha256"] != policy_sha256(policy):
            raise ValueError("policy document differs from publication")
        _anchor.validate_head(head)
        if (head["anchorId"] != claim["anchorId"] or
                head["epoch"] != claim["epoch"] or
                head["revision"] != minimum_revision + 1 or
                head["previousHeadSha256"] != minimum_head_sha256 or
                head["policySha256"] != claim["policySha256"] or
                head["checkpointSha256"] != claim["checkpointSha256"] or
                _anchor.digest(head) != claim["anchorHeadSha256"]):
            raise ValueError("anchor head differs from publication")
        request = _roles._parse(two_role_request_bytes)
        if (request["requestId"] != claim["requestId"] or
                request["anchorId"] != claim["anchorId"] or
                request["epoch"] != claim["epoch"] or
                request["expectedRevision"] != minimum_revision or
                request["expectedHeadSha256"] != minimum_head_sha256 or
                request["proposalSha256"] != _anchor.digest(head)):
            raise ValueError("two-role proposal differs from signed publication")
        return _blocked("signed publication consistent with supplied pins only",
                        publicationConsistent=True)
    except (ValueError, KeyError, TypeError, UnicodeError, OverflowError) as exc:
        return _blocked("policy publication invalid: " + type(exc).__name__)
