"""GE-04 R3 TPM2C: strict read-only *candidate* NV contract assessment.

A successful shape match is NOT an independently administered trust root,
authorization, permission to allocate NV, or proof of anti-rollback. This
module makes no TPM calls. Inputs come from the earlier read-only inspector,
whose command outputs are observations rather than trusted attestations.
"""
from __future__ import annotations

import re

_HEX64 = re.compile(r"[a-f0-9]{64}\Z")
_HANDLE = re.compile(r"0x[0-9a-f]{1,8}\Z")
_NVID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
# TPM 2.0 TPMA_NV.TPM_NT: 0=ordinary, 1=counter, 4=extend.
_TPMA_NV_TYPE_MASK = 0xF0
_TPMA_NV_EXTEND = 0x40
_RESERVED = frozenset((
    0x01410001, 0x01410002, 0x01800100, 0x01880001, 0x01880011,
))
# Strict deny list for a checkpoint target. A simple password-only authority
# or ownerwrite is insufficient. Actual policy semantics require TPM sessions.
_BANNED_FRIENDLY = frozenset((
    "authwrite", "ownerwrite", "ppwrite", "policydelete",
))


def _blocked(reason: str, **details) -> dict:
    return {
        "status": "blocked",
        "securityHoldActive": True,
        "authorizationGranted": False,
        "hardwareQualified": False,
        "independentAuthorityQualified": False,
        "rollbackResistant": False,
        "reason": reason,
        **details,
    }


def _handle(value):
    if type(value) is not str or _HANDLE.fullmatch(value) is None:
        raise ValueError("invalid strict NV handle format")
    number = int(value, 16)
    if not 0x01000000 <= number <= 0x01FFFFFF:
        raise ValueError("handle is not a TPM NV index")
    return number


def _name(value):
    # tpm2_nvreadpublic returns name as TPM2B_NAME: 0x000b (SHA256) + 32 bytes.
    # A name is a *hash of the public area*, not an attested operator identity.
    if (type(value) is not str or
            re.fullmatch(r"000b[a-f0-9]{64}", value) is None):
        raise ValueError("untrusted NV public name")
    return value


def _metadata(public):
    if type(public) is not dict:
        raise ValueError("invalid NV public metadata")
    if not {"name", "hash algorithm", "attributes", "size"} <= set(public):
        raise ValueError("missing TPM NV public fields")
    if set(public) - {"name", "hash algorithm", "attributes", "size",
                      "authorization policy"}:
        raise ValueError("unknown NV public fields")
    _name(public["name"])
    alg = public["hash algorithm"]
    attrs = public["attributes"]
    if type(alg) is not dict or alg.get("friendly") != "sha256":
        raise ValueError("incorrect NV name hash")
    if type(attrs) is not dict or type(attrs.get("value")) is not int:
        raise ValueError("invalid TPM attributes")
    if attrs["value"] < 0 or attrs["value"] > 0xFFFFFFFF:
        raise ValueError("out-of-range NV attributes")
    tokens = attrs.get("friendly")
    if type(tokens) is not str:
        raise ValueError("missing attribute explanation")
    friendly = set(tokens.split("|"))
    if not friendly or any(not x for x in friendly):
        raise ValueError("invalid attribute tokens")
    if type(public["size"]) is not int or public["size"] != 32:
        raise ValueError("not a 32-byte SHA-256 extend index")
    if attrs["value"] & _TPMA_NV_TYPE_MASK != _TPMA_NV_EXTEND:
        raise ValueError("index is not NV Extend")
    if "nt=0x4" not in friendly:
        raise ValueError("friendly type differs from numeric TPM attribute")
    # TPM2 TPMA_NV numeric bits: PPWRITE=0x1, OWNERWRITE=0x2,
    # AUTHWRITE=0x4, POLICYWRITE=0x8, POLICY_DELETE=0x400,
    # AUTHREAD=0x40000. Reject forged friendly labels and alternate writers.
    bits = attrs["value"]
    if not (bits & 0x8 and bits & 0x40000) or bits & (0x7 | 0x400):
        raise ValueError("numeric policy authorization bits inconsistent")
    if not {"policywrite", "authread"} <= friendly:
        raise ValueError("required access pattern absent")
    if _BANNED_FRIENDLY & friendly:
        raise ValueError("unrestricted write or delete capability")
    # Policy digest by itself cannot attest a policy session, identity or
    # administrative control. Require pinned exact policy hash *as evidence*.
    policy = public.get("authorization policy")
    if type(policy) is not str or _HEX64.fullmatch(policy.lower()) is None:
        raise ValueError("missing NV authorization policy digest")
    return policy.lower()


def assess_nv_candidate(*, inventory_result, handle: str,
                        nv_public_result=None, expected_name=None,
                        expected_policy_digest=None, enrollment_id=None) -> dict:
    """Unprovisioned inventory and optionally pinned public shape validation.

    The function deliberately returns only blocked results, even for a
    well-formed matching future index, because public metadata is not proof
    of its ownership, hierarchy control, or protection against TPM clear.
    """
    try:
        number = _handle(handle)
        if number in _RESERVED:
            raise ValueError("reserved pre-existing index; never reuse")
        if (type(inventory_result) is not dict or
                inventory_result.get("status") != "blocked" or
                inventory_result.get("inventoryObserved") is not True or
                inventory_result.get("authorizationGranted") is not False):
            raise ValueError("no complete read-only TPM inventory")
        inventory = inventory_result.get("inventory")
        if type(inventory) is not dict:
            raise ValueError("bad capability inventory")
        fixed, variable = inventory["properties-fixed"], inventory["properties-variable"]
        family = fixed["TPM2_PT_FAMILY_INDICATOR"]
        if (type(family) is not dict or family.get("value") != "2.0" or
                type(variable) is not dict or
                type(variable.get("TPM2_PT_PERMANENT")) is not dict):
            raise ValueError("TPM identity and hierarchies not observed")
        handles = inventory["existingHandles"]
        if type(handles) not in (tuple, list):
            raise ValueError("invalid observed handle list")
        observed = [_handle(v) for v in handles]
        if len(observed) != len(set(observed)):
            raise ValueError("duplicate handle in inventory")
        if len(observed) > 256:
            raise ValueError("oversized NV handle inventory")
        if number not in observed:
            if nv_public_result is not None:
                raise ValueError("public metadata for absent handle")
            return _blocked(
                "candidate index absent: no allocation or trust claim",
                candidateAbsent=True,
                candidateHandle=handle,
            )
        if nv_public_result is None:
            raise ValueError("index exists but was not inspected")
        if (type(nv_public_result) is not dict or
                nv_public_result.get("status") != "blocked" or
                nv_public_result.get("nvPublicObserved") is not True or
                nv_public_result.get("authorizationGranted") is not False or
                _handle(nv_public_result.get("handle")) != number):
            raise ValueError("NV metadata handle mismatch")
        if (type(enrollment_id) is not str or
                _NVID.fullmatch(enrollment_id) is None or
                type(expected_name) is not str or
                type(expected_policy_digest) is not str or
                _HEX64.fullmatch(expected_policy_digest) is None):
            raise ValueError("missing exact enrollment references")
        public = nv_public_result.get("metadata")
        policy = _metadata(public)
        if _name(expected_name) != _name(public["name"]):
            raise ValueError("substituted NV index public Name")
        if policy != expected_policy_digest:
            raise ValueError("unexpected NV authorization policy")
        # This means SHAPE and *supplied* pins agree, never ownership.
        return _blocked(
            "NV Extend public shape matches supplied pins, NOT security authorization",
            publicShapeMatches=True,
            candidateHandle=handle,
            enrollmentId=enrollment_id,
        )
    except (KeyError, TypeError, ValueError, OverflowError, AttributeError):
        return _blocked("NV candidate or inventory untrusted")
