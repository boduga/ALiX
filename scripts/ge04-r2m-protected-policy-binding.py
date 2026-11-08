"""GE-04-R2M: protected policy / kernel peer / issuer custody consistency.

Qualification-only. Inputs passed as Python objects are NOT privileged evidence.
The policy file must be independently provisioned and protected. This module
never issues an approval, clears custody, signs a manifest or launches a worker.
"""
from __future__ import annotations
import importlib.util
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _load(filename, name):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("missing qualification dependency")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_R2H = _load("ge04-r2h-recovery-manifest.py", "r2m_r2h")
_R2J = _load("ge04-r2j-issuer-manifest-binding.py", "r2m_r2j")
_R2K = _load("ge04-r2k-peercred-gate.py", "r2m_r2k")
_POLICY_KEYS = {"schema", "issuerId", "issuerUid", "verifierUid",
                "workerUid", "attackerUid", "custodyDir", "manifestName",
                "cgroupRelative", "bootId", "policyRevision"}


def inspect_protected_issuer_policy(
    policy_path, connection, claim, recovery_record, *,
    policy_owner_uid=0, custody_owner_uid=None, boot_id=None,
):
    """Cross-check policy source, peer kernel facts, and durable custody.

    policy_owner_uid/custody_owner_uid overrides exist ONLY for nonroot
    deterministic fixture tests. Neither caller injection nor matching values
    creates trusted external authority. Output stays blocked unconditionally.
    """
    result = {"status": "blocked", "policyVerified": False,
              "peerVerified": False, "custodyVerified": False,
              "consistencyChecksPassed": False, "reasons": []}
    reasons = result["reasons"]
    try:
        policy = _R2H._read_manifest(policy_path, required_uid=policy_owner_uid)
        if not isinstance(policy, dict) or set(policy) != _POLICY_KEYS:
            raise ValueError("unknown protected policy schema")
        if policy["schema"] != "ge04-r2m-v1":
            raise ValueError("unsupported protected policy version")
        for key in ("issuerUid", "verifierUid", "workerUid", "attackerUid"):
            if type(policy[key]) is not int or policy[key] <= 0:
                raise ValueError("invalid role UID")
        roles = [policy[key] for key in
                 ("issuerUid", "verifierUid", "workerUid", "attackerUid")]
        if len(set(roles)) != 4:
            raise ValueError("issuer/verifier/worker/attacker must have distinct UIDs")
        for key in ("issuerId", "custodyDir", "manifestName",
                    "cgroupRelative", "bootId", "policyRevision"):
            if not isinstance(policy[key], str) or not policy[key]:
                raise ValueError("invalid policy binding")
        if custody_owner_uid is None:
            custody_owner_uid = policy["issuerUid"]
        if custody_owner_uid != policy["issuerUid"]:
            raise ValueError("issuer custody UID differs from policy issuer")
        # Match separately read kernel boot ID; override is fixture-only.
        if boot_id is None:
            boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        if policy["bootId"] != boot_id:
            raise ValueError("stale issuer policy kernel boot")
        result["policyVerified"] = True

        peer = _R2K.inspect_peer_credentials(
            connection, claim, policy["issuerUid"],
            forbidden_uids=(policy["workerUid"], policy["attackerUid"],
                            policy["verifierUid"]))
        if peer.get("peerIdentityConsistent") is True:
            result["peerVerified"] = True
        else:
            reasons.append("kernel peer fails issuer policy identity")
        # R2K compares against the executing verifier's UID, which cannot be
        # overwritten by untrusted policy, but also verify configured UID.
        import os
        if os.geteuid() != policy["verifierUid"]:
            result["peerVerified"] = False
            reasons.append("verifier effective UID differs from protected policy")

        custody = _R2J.inspect_issuer_manifest_binding(
            policy["custodyDir"], policy["manifestName"], recovery_record,
            policy["cgroupRelative"], policy["issuerId"],
            required_uid=custody_owner_uid, boot_id=boot_id)
        if custody.get("consistencyChecksPassed") is True:
            result["custodyVerified"] = True
        else:
            reasons.append("issuer custody/manifest consistency missing")
        result["consistencyChecksPassed"] = bool(
            result["policyVerified"] and result["peerVerified"]
            and result["custodyVerified"] and not reasons)
    except (OSError, ValueError, TypeError, KeyError, PermissionError) as exc:
        reasons.append("protected issuer policy unavailable: " + type(exc).__name__)
    reasons.append("no independently authenticated issuer authority; GE-04 security hold")
    return result
