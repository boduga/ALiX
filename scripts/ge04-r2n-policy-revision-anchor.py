"""GE-04-R2N policy-revision anchor consistency gate.

QUALIFICATION ONLY. A separately provisioned read-only anchor pins an exact
policy revision and canonical digest. Neither the policy nor its anchor may
be automatically created, advanced, overwritten or accepted as authorization.
A verifier which trusts caller-provided root paths/UIDs is NOT a secure
production deployment. Rollback of both files remains possible absent a
trusted external monotonic counter or immutable publisher.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re


def _load(filename, name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).resolve().with_name(filename))
    if spec is None or spec.loader is None:
        raise RuntimeError("missing qualification dependency")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_R2H = _load("ge04-r2h-recovery-manifest.py", "r2n_r2h")
_R2M = _load("ge04-r2m-protected-policy-binding.py", "r2n_r2m")
_ANCHOR_KEYS = {"schema", "policyRevision", "policySha256", "policyBootId",
                "issuerUid", "issuerId"}
_REVISION_RE = re.compile(r"[1-9][0-9]{0,17}")
_SHA256_RE = re.compile(r"[a-f0-9]{64}")


def canonical_digest(policy):
    """Stable canonical representation, never use a digest as a signature."""
    return hashlib.sha256(json.dumps(
        policy, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        allow_nan=False).encode("ascii")).hexdigest()


def inspect_policy_revision(policy_path, anchor_path, *, policy_owner_uid=0,
                            anchor_owner_uid=0, boot_id=None):
    """Read only. Caller-supplied UIDs are for nonroot fixture tests ONLY.

    Anchor MUST be independently provisioned and strictly protected, with
    separate parent directory; equal revisions and canonical digests are
    mandatory. Higher revisions do not auto-advance an anchor.
    """
    result = {"status": "blocked", "revisionPinned": False,
              "policyProvenanceQualified": False, "reasons": []}
    reasons = result["reasons"]
    try:
        policy_parent = Path(policy_path).parent
        anchor_parent = Path(anchor_path).parent
        if policy_parent == anchor_parent:
            raise ValueError("policy and anchor must have separate protected parents")
        if type(policy_owner_uid) is not int or type(anchor_owner_uid) is not int:
            raise ValueError("invalid expected owners")
        if policy_owner_uid < 0 or anchor_owner_uid < 0:
            raise ValueError("negative owner UID")
        if anchor_owner_uid != 0 and anchor_owner_uid == policy_owner_uid:
            # Fixture-only simulated publisher; never production provenance.
            reasons.append("anchor and policy use same unprivileged owner")
        policy_before = _R2H._read_manifest(
            str(policy_path), required_uid=policy_owner_uid)
        anchor_before = _R2H._read_manifest(
            str(anchor_path), required_uid=anchor_owner_uid)
        if not isinstance(policy_before, dict) or not isinstance(anchor_before, dict):
            raise ValueError("invalid manifest types")
        if set(anchor_before) != _ANCHOR_KEYS or anchor_before["schema"] != "ge04-r2n-v1":
            raise ValueError("unknown revision-anchor schema")
        revision = policy_before.get("policyRevision")
        expected = anchor_before.get("policyRevision")
        if (type(revision) is not str or type(expected) is not str
                or not _REVISION_RE.fullmatch(revision)
                or not _REVISION_RE.fullmatch(expected)):
            raise ValueError("invalid monotonic revision")
        if revision != expected:
            reasons.append("policy revision not pinned: stale, future or conflicting")
        digest = anchor_before.get("policySha256")
        if type(digest) is not str or not _SHA256_RE.fullmatch(digest):
            raise ValueError("invalid anchored SHA-256")
        if canonical_digest(policy_before) != digest:
            reasons.append("policy content differs from protected revision anchor")
        if (anchor_before.get("issuerUid") != policy_before.get("issuerUid")
                or type(anchor_before.get("issuerUid")) is not int
                or anchor_before.get("issuerId") != policy_before.get("issuerId")):
            reasons.append("issuer identity differs from independent anchor")
        if boot_id is None:
            boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        if (anchor_before.get("policyBootId") != boot_id
                or policy_before.get("bootId") != boot_id):
            reasons.append("boot generation differs from policy or anchor")
        # Require a stable pair across the complete observation; an attacker
        # controlling both writable files can still interleave substitutions.
        policy_after = _R2H._read_manifest(
            str(policy_path), required_uid=policy_owner_uid)
        anchor_after = _R2H._read_manifest(
            str(anchor_path), required_uid=anchor_owner_uid)
        if policy_before != policy_after or anchor_before != anchor_after:
            reasons.append("policy or anchor replaced during observation")
        result["revisionPinned"] = not reasons
    except (OSError, ValueError, TypeError, KeyError, UnicodeError) as exc:
        reasons.append("revision anchor untrusted or unavailable: " +
                       type(exc).__name__)
    reasons.append("no independently authenticated publisher or rollback-resistant counter")
    return result


def inspect_anchored_issuer_policy(policy_path, anchor_path, connection, claim,
                                   recovery_record, *, policy_owner_uid=0,
                                   anchor_owner_uid=0, custody_owner_uid=None,
                                   boot_id=None):
    """Combine R2N anchor with R2M peer/custody observations; always HOLD."""
    pinned = inspect_policy_revision(
        policy_path, anchor_path, policy_owner_uid=policy_owner_uid,
        anchor_owner_uid=anchor_owner_uid, boot_id=boot_id)
    result = {"status": "blocked", "revisionPinned": pinned["revisionPinned"],
              "policyProvenanceQualified": False,
              "combinedConsistency": False, "reasons": list(pinned["reasons"])}
    if not pinned["revisionPinned"]:
        result["reasons"].append("R2M skipped because revision anchor failed")
        return result
    observed = _R2M.inspect_protected_issuer_policy(
        policy_path, connection, claim, recovery_record,
        policy_owner_uid=policy_owner_uid,
        custody_owner_uid=custody_owner_uid, boot_id=boot_id)
    result["combinedConsistency"] = (
        observed.get("consistencyChecksPassed") is True)
    if not result["combinedConsistency"]:
        result["reasons"].append("R2M issuer/peer/custody evidence incomplete")
    result["reasons"].append("anchored consistency never authorizes recovery")
    return result
