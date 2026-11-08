"""GE-04-R2O: independently-owned publisher journal consistency gate.

Read-only qualification artifact. The trusted checkpoint is expected to live
outside the publisher/issuer/worker writable domains. Even a correct hash
chain cannot prevent a coordinated rollback of the journal and checkpoint;
a real external monotonic authority is REQUIRED. No issuer or recovery grant.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _load(filename, name):
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("missing qualification module")
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


_R2H = _load("ge04-r2h-recovery-manifest.py", "r2o_r2h")
_R2N = _load("ge04-r2n-policy-revision-anchor.py", "r2o_r2n")
_ENTRY_KEYS = {"schema", "revision", "policySha256", "previousEntrySha256",
               "publisherUid", "issuerUid", "issuerId", "bootId"}
_CHECKPOINT_KEYS = {"schema", "revision", "entrySha256", "policySha256",
                    "publisherUid", "bootId"}
_GENESIS = "0" * 64
_HEX = set("0123456789abcdef")


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def _valid_digest(value):
    return type(value) is str and len(value) == 64 and set(value) <= _HEX


def _read_journal(path, uid):
    """Descriptor-walk and validate one immutable-style protected journal file."""
    # Reuse R2H protected reader only for JSON-shaped bounded files. This
    # prototype caps history to 4 KiB; production requires a streamed FD-based
    # journal with signed checkpoint and resource limits.
    return _R2H._read_manifest(str(path), required_uid=uid)


def inspect_publisher_chain(journal_path, checkpoint_path, *,
                            publisher_uid, checkpoint_uid=0, boot_id=None):
    """Validate exact revision continuity and independent checkpoint agreement.

    UID overrides beyond root checkpoint owner are test-only; same-UID files
    cannot prove separation. A matched result remains status=blocked.
    """
    result = {"status": "blocked", "journalConsistent": False,
              "checkpointMatches": False, "publisherProvenanceQualified": False,
              "rollbackResistant": False, "reasons": []}
    reasons = result["reasons"]
    try:
        if (type(publisher_uid) is not int or publisher_uid <= 0
                or type(checkpoint_uid) is not int or checkpoint_uid < 0):
            raise ValueError("invalid publisher or checkpoint UID")
        if Path(journal_path).parent == Path(checkpoint_path).parent:
            raise ValueError("journal and checkpoint share a parent")
        if publisher_uid == checkpoint_uid:
            raise ValueError("publisher can modify checkpoint")
        if boot_id is None:
            boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()

        entries = _read_journal(journal_path, publisher_uid)
        checkpoint = _read_journal(checkpoint_path, checkpoint_uid)
        if (not isinstance(entries, list) or not 1 <= len(entries) <= 16
                or not isinstance(checkpoint, dict)
                or set(checkpoint) != _CHECKPOINT_KEYS
                or checkpoint["schema"] != "ge04-r2o-checkpoint-v1"):
            raise ValueError("unknown journal/checkpoint schema")
        prev = _GENESIS
        last = None
        for index, entry in enumerate(entries, start=1):
            if not isinstance(entry, dict) or set(entry) != _ENTRY_KEYS:
                raise ValueError("invalid publisher journal entry")
            if (entry["schema"] != "ge04-r2o-entry-v1"
                    or type(entry["revision"]) is not int
                    or entry["revision"] != index
                    or type(entry["publisherUid"]) is not int
                    or entry["publisherUid"] != publisher_uid
                    or type(entry["issuerUid"]) is not int
                    or entry["issuerUid"] <= 0
                    or entry["issuerUid"] == publisher_uid
                    or type(entry["issuerId"]) is not str
                    or not entry["issuerId"]
                    or type(entry["bootId"]) is not str
                    or entry["bootId"] != boot_id
                    or not _valid_digest(entry["policySha256"])
                    or entry["previousEntrySha256"] != prev):
                raise ValueError("journal continuity or publisher identity invalid")
            prev = _sha256(_canonical(entry))
            last = entry
        result["journalConsistent"] = True
        if (type(checkpoint["revision"]) is int
                and checkpoint["revision"] == len(entries)
                and checkpoint["entrySha256"] == prev
                and checkpoint["policySha256"] == last["policySha256"]
                and checkpoint["publisherUid"] == publisher_uid
                and checkpoint["bootId"] == boot_id):
            result["checkpointMatches"] = True
        else:
            reasons.append("external checkpoint and journal head disagree")
        if entries != _read_journal(journal_path, publisher_uid) or (
                checkpoint != _read_journal(checkpoint_path, checkpoint_uid)):
            reasons.append("journal or checkpoint changed during observation")
            result["journalConsistent"] = False
            result["checkpointMatches"] = False
    except (OSError, ValueError, TypeError, KeyError, UnicodeError) as exc:
        reasons.append("publisher journal unavailable or malformed: " +
                       type(exc).__name__)
    reasons.append("hash chain and UID metadata are not external monotonic authority")
    return result


def inspect_publisher_policy_binding(journal_path, checkpoint_path,
                                     policy_path, anchor_path, *,
                                     publisher_uid, checkpoint_uid=0,
                                     policy_owner_uid=0, anchor_owner_uid=0,
                                     boot_id=None):
    """Combine R2O journal and R2N policy pinning; never admit/recover."""
    chain = inspect_publisher_chain(
        journal_path, checkpoint_path, publisher_uid=publisher_uid,
        checkpoint_uid=checkpoint_uid, boot_id=boot_id)
    response = {"status": "blocked",
                "chainConsistent": chain["journalConsistent"]
                                   and chain["checkpointMatches"],
                "policyMatched": False,
                "qualified": False,
                "reasons": list(chain["reasons"])}
    if not response["chainConsistent"]:
        response["reasons"].append("policy binding skipped; chain untrusted")
        return response
    anchor = _R2N.inspect_policy_revision(
        policy_path, anchor_path, policy_owner_uid=policy_owner_uid,
        anchor_owner_uid=anchor_owner_uid, boot_id=boot_id)
    try:
        checkpoint = _read_journal(checkpoint_path, checkpoint_uid)
        policy = _R2H._read_manifest(str(policy_path), required_uid=policy_owner_uid)
        if (anchor["revisionPinned"]
                and checkpoint["policySha256"] == _R2N.canonical_digest(policy)
                and str(checkpoint["revision"]) == policy.get("policyRevision")):
            response["policyMatched"] = True
        else:
            response["reasons"].append("anchored policy does not match publisher head")
    except (OSError, ValueError, TypeError, KeyError):
        response["reasons"].append("anchored policy could not be verified")
    return response
