"""GE-04-R2S independently-verifiable anchor protocol, qualification only.

A verifier accepts checkpoint history only with an independently provisioned
anchor public key and a *separately trusted* minimum checkpoint. Signing a
record does not prove the signer is independent or its storage is monotonic.
This module provides no network write route or ALiX authorization.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
import threading
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HEX = re.compile(r"[a-f0-9]{64}\Z")
MAX_REVISION = 2**53 - 1
SCHEMA = "ge04-r2s-anchor-v1"
DOMAIN = b"ALIX-GE04-R2S-ANCHOR-V1\0"
HEAD_KEYS = frozenset({"schema", "anchorId", "epoch", "revision",
                       "policySha256", "checkpointSha256",
                       "signerKeySha256", "previousHeadSha256"})
GENESIS = "0" * 64


def canonical(data: dict) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def digest(head: dict) -> str:
    return hashlib.sha256(DOMAIN + canonical(head)).hexdigest()


def validate_head(head: Any) -> None:
    if type(head) is not dict or set(head) != HEAD_KEYS:
        raise ValueError("invalid protected head schema")
    if head["schema"] != SCHEMA:
        raise ValueError("unknown anchor schema")
    for name in ("anchorId", "epoch"):
        value = head[name]
        if type(value) is not str or not 1 <= len(value) <= 128 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
            raise ValueError("invalid anchor identity/epoch")
    if type(head["revision"]) is not int or not 1 <= head["revision"] <= MAX_REVISION:
        raise ValueError("invalid anchor revision")
    for name in ("policySha256", "checkpointSha256", "signerKeySha256", "previousHeadSha256"):
        value = head[name]
        if type(value) is not str or HEX.fullmatch(value) is None:
            raise ValueError("invalid anchor digest")
    if head["revision"] == 1 and head["previousHeadSha256"] != GENESIS:
        raise ValueError("bad genesis link")
    if head["revision"] > 1 and head["previousHeadSha256"] == GENESIS:
        raise ValueError("missing predecessor")


def make_head(*, anchor_id: str, epoch: str, revision: int, policy: str,
              checkpoint: str, signer_key_sha256: str, predecessor: str) -> dict:
    head = {"schema": SCHEMA, "anchorId": anchor_id, "epoch": epoch,
            "revision": revision, "policySha256": policy,
            "checkpointSha256": checkpoint, "signerKeySha256": signer_key_sha256,
            "previousHeadSha256": predecessor}
    validate_head(head)
    return head


def verify_envelope(envelope: Any, *, anchor_public_key: bytes,
                    anchor_id: str, epoch: str) -> dict:
    """Verify only envelope integrity/identity; never trust its storage origin."""
    if (type(envelope) is not dict or set(envelope) != {"head", "signature"}
            or type(envelope["signature"]) is not str
            or re.fullmatch(r"[a-f0-9]{128}", envelope["signature"]) is None
            or type(anchor_public_key) is not bytes or len(anchor_public_key) != 32):
        raise ValueError("invalid anchor envelope")
    head = envelope["head"]
    validate_head(head)
    if head["anchorId"] != anchor_id or head["epoch"] != epoch:
        raise ValueError("unexpected protected authority identity")
    try:
        Ed25519PublicKey.from_public_bytes(anchor_public_key).verify(
            bytes.fromhex(envelope["signature"]), DOMAIN + canonical(head))
    except Exception as exc:
        raise ValueError("invalid anchor signature") from exc
    return head


def assess_chain(envelopes: Any, *, anchor_public_key: bytes, anchor_id: str,
                 epoch: str, trusted_floor: dict) -> dict:
    """Check continuity from a separately supplied trusted floor; always HOLD.

    Caller-provided floor is *not* a trusted authority. Repeated or
    contradictory heads are rejected, including a conflicting view at a
    previously verified revision. Empty history is not proof of continuity.
    """
    reasons = []
    consistent = False
    try:
        if type(trusted_floor) is not dict or set(trusted_floor) != {"revision", "headSha256"}:
            raise ValueError("untrusted floor schema")
        revision = trusted_floor["revision"]
        previous = trusted_floor["headSha256"]
        if type(revision) is not int or not 0 <= revision < MAX_REVISION or type(previous) is not str or HEX.fullmatch(previous) is None:
            raise ValueError("invalid trusted floor")
        if revision == 0 and previous != GENESIS:
            raise ValueError("invalid genesis floor")
        if type(envelopes) is not list or not 1 <= len(envelopes) <= 256:
            raise ValueError("missing/bounded chain history")
        for item in envelopes:
            head = verify_envelope(item, anchor_public_key=anchor_public_key,
                                   anchor_id=anchor_id, epoch=epoch)
            if head["revision"] != revision + 1:
                raise ValueError("revision rollback, gap or replay")
            if head["previousHeadSha256"] != previous:
                raise ValueError("checkpoint fork or inconsistent predecessor")
            previous = digest(head)
            revision = head["revision"]
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        reasons.append(str(exc))
    else:
        consistent = True
        reasons.append("history consistent only with caller-supplied floor")
    reasons.append("independent protected storage and authority provisioning unqualified")
    return {"status": "blocked", "securityHoldActive": True,
            "historyConsistent": consistent,
            "rollbackResistant": False, "authorizationGranted": False,
            "reasons": reasons}


@dataclass(frozen=True)
class Proposal:
    expected_revision: int
    expected_head_sha256: str
    head: dict
    publisher: str


class QualificationCompareStore:
    """Threadsafe process-local simulator; NOT a protected anchor.

    The committer role must be authenticated by external infrastructure in a
    future production implementation. This simulator takes an explicit role
    token solely to exercise deny rules, not to attest a real caller.
    """

    def __init__(self, genesis: dict | None = None):
        self._lock = threading.Lock()
        self._head = dict(genesis) if genesis is not None else None
        if self._head is not None:
            validate_head(self._head)

    def snapshot(self) -> dict | None:
        with self._lock:
            return dict(self._head) if self._head is not None else None

    def propose_and_commit(self, proposal: Proposal, *, asserted_role: str,
                           publisher_allowlist: frozenset[str],
                           simulate_unknown_outcome: bool = False) -> dict:
        if (asserted_role != "committer" or proposal.publisher not in publisher_allowlist):
            return {"status": "blocked", "reason": "unverified authority",
                    "authorizationGranted": False}
        try:
            validate_head(proposal.head)
        except (ValueError, TypeError):
            return {"status": "blocked", "reason": "invalid head",
                    "authorizationGranted": False}
        with self._lock:
            current = self._head
            revision = current["revision"] if current is not None else 0
            previous = digest(current) if current is not None else GENESIS
            proposed = proposal.head
            same_epoch = current is None or (
                current["anchorId"] == proposed["anchorId"]
                and current["epoch"] == proposed["epoch"]
                and current["signerKeySha256"] == proposed["signerKeySha256"])
            if (not same_epoch or type(proposal.expected_revision) is not int
                    or proposal.expected_revision != revision
                    or proposal.expected_head_sha256 != previous
                    or proposed["revision"] != revision + 1
                    or proposed["previousHeadSha256"] != previous):
                return {"status": "blocked", "reason": "stale, forked or invalid advance",
                        "authorizationGranted": False}
            self._head = dict(proposed)
            if simulate_unknown_outcome:
                # Models a committed update with a lost acknowledgment. Verifier
                # MUST independently query/reconcile, never infer successful grant.
                return {"status": "blocked", "reason": "commit outcome unknown",
                        "authorizationGranted": False}
            return {"status": "recorded-qualification-only", "revision": proposed["revision"],
                    "headSha256": digest(proposed), "authorizationGranted": False}
