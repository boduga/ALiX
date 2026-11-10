"""GE-04 protected transaction owner review contract: fail-closed gate evaluator.

Caller-supplied claims, even exact ones, cannot prove protected custody.
No root, systemd mutation, cleanup, ACK, or production registration.
"""
import hashlib
import re
from collections.abc import Mapping
from types import MappingProxyType

from bootstrap_binding import UNIT
from prebirth_issuance_contract import canonical_prebirth

GATES = (
    "SOURCE_REVIEWED", "ORIGINAL_JOURNAL_PROTECTED",
    "EXCLUSIVE_UNIT_BIRTH", "ROOT_MANAGER_JOB_BOUND",
    "KERNEL_RESOURCE_CUSTODY", "PROTECTED_ACK_AND_TERMINAL",
    "APPROVED_DISPOSABLE_VM", "INDEPENDENT_HUMAN_ACCEPTANCE",
)
GATE_BLOCKERS = MappingProxyType({
    "SOURCE_REVIEWED": "Reviewed immutable source, binary and toolchain hash",
    "ORIGINAL_JOURNAL_PROTECTED": "Externally root-owned prebirth and durable attempt fence",
    "EXCLUSIVE_UNIT_BIRTH": "Independent new fixed unit, non-adoption and request origin",
    "ROOT_MANAGER_JOB_BOUND": "Protected pre-request subscription and genuine job completion",
    "KERNEL_RESOURCE_CUSTODY": "Pinned original keeper, mount namespace and cgroup FDs",
    "PROTECTED_ACK_AND_TERMINAL": "Independent phase ACK, EMPTY/DENIED, cleanup and recovery",
    "APPROVED_DISPOSABLE_VM": "Authorized one-purpose root VM fault-injection evidence",
    "INDEPENDENT_HUMAN_ACCEPTANCE": "Adversarial human signoff and explicit Q13 release",
})
_FIELDS = frozenset(("schemaVersion", "unit", "prebirthSha256",
                    "requestedGate", "claims"))
_HEX = re.compile(r"[0-9a-f]{64}")


def evaluate_protected_owner_review(prebirth, asserted):
    """Return blockers, never trust, eligibility, approval, or admission.

    All boolean claims are untrusted and intentionally cannot clear gates.
    """
    raw = canonical_prebirth(prebirth)
    if not isinstance(asserted, Mapping) or frozenset(asserted) != _FIELDS:
        raise ValueError("Incomplete protected issuer review packet")
    claims = asserted["claims"]
    if (type(asserted["schemaVersion"]) is not int
            or asserted["schemaVersion"] != 1
            or asserted["unit"] != UNIT
            or type(asserted["prebirthSha256"]) is not str
            or _HEX.fullmatch(asserted["prebirthSha256"]) is None
            or asserted["prebirthSha256"] != hashlib.sha256(raw).hexdigest()
            or type(asserted["requestedGate"]) is not str
            or asserted["requestedGate"] not in GATES
            or not isinstance(claims, Mapping)
            or frozenset(claims) != frozenset(GATES)
            or any(type(claims[k]) is not bool for k in GATES)):
        raise ValueError("Malformed or mismatched protected owner claims")
    # A caller's self-assertions NEVER authenticate an authority boundary.
    return MappingProxyType({
        "status": "SECURITY_HOLD_PROTECTED_ORIGIN_UNAVAILABLE",
        "requestedGate": asserted["requestedGate"],
        "required": tuple(GATES[:GATES.index(asserted["requestedGate"]) + 1]),
        "unverified": tuple(GATES),
        "originalDigest": asserted["prebirthSha256"],
    })


class ProtectedOwnerBoundary:
    """Non-executable authorization barrier, with no success path."""

    __slots__ = ("_quarantined", "_checked")

    def __init__(self):
        self._quarantined = False
        self._checked = False

    @property
    def status(self):
        return ("SECURITY_HOLD_QUARANTINED" if self._quarantined
                else "SECURITY_HOLD_UNQUALIFIED")

    def inspect(self, original, asserted):
        if self._checked or self._quarantined:
            self._quarantined = True
            raise ValueError("Protected issuer review attempt already consumed")
        self._checked = True
        try:
            return evaluate_protected_owner_review(original, asserted)
        except Exception:
            self._quarantined = True
            raise

    def _deny(self, action):
        self._quarantined = True
        raise PermissionError("GE-04 SECURITY HOLD: no protected owner " + action)

    def publish_original(self, *_a, **_k):
        self._deny("journal publisher")

    def create_unit(self, *_a, **_k):
        self._deny("systemd creation")

    def issue_ack(self, *_a, **_k):
        self._deny("phase ACK")

    def recover(self, *_a, **_k):
        self._deny("recovery")

    def admit_worker(self, *_a, **_k):
        self._deny("worker admission")
