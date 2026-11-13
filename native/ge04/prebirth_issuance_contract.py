"""GE-04 pre-birth issuance state machine: pure, NON-AUTHORIZING contract.

This models the prerequisite ordering for a future protected root bootstrap:
  protected PREBIRTH intent -> observed NEW fixed unit birth -> frozen record.
The inputs are ALL caller-provided and are NOT independently authenticated.
No durable persistence, D-Bus calls, root operations, ACK or worker admission.
"""
import json
import re
from types import MappingProxyType

from bootstrap_binding import UNIT, parse_bootstrap_binding

_FIELDS = frozenset((
    "schemaVersion", "unit", "bootId", "attempt", "nonce",
    "sourceSha256", "controllerSha256", "expectedAbsent",
))
_BIRTH = frozenset(("invocation", "keeperPid", "keeperTicks",
                    "mountId", "mountDevice", "mountRoot", "ancestry",
                    "restartCount", "unit", "bootId", "attempt", "nonce"))
_HEX64 = re.compile(r"[0-9a-f]{64}")
_HEX32 = re.compile(r"[0-9a-f]{32}")
STAGES = ("PREBIRTH", "BIRTH_OBSERVED", "QUARANTINED")


def _exact(value, keys):
    if type(value) is not dict or frozenset(value) != keys:
        raise ValueError("Incomplete original issuance evidence")


def canonical_prebirth(claim):
    """Validate fixed original shape; cannot establish trusted issuer."""
    _exact(claim, _FIELDS)
    if (type(claim["schemaVersion"]) is not int or claim["schemaVersion"] != 1
            or claim["unit"] != UNIT
            or type(claim["bootId"]) is not str
            or _HEX32.fullmatch(claim["bootId"]) is None
            or type(claim["attempt"]) is not int
            or not 0 < claim["attempt"] < 2**63
            or claim["expectedAbsent"] is not True
            or any(type(claim[k]) is not str or _HEX64.fullmatch(claim[k]) is None
                   for k in ("nonce", "sourceSha256", "controllerSha256"))):
        raise ValueError("Malformed original prebirth claim")
    # A caller can mint a canonical-looking blob. This is format, not custody.
    raw = (json.dumps(claim, sort_keys=True, separators=(",", ":"))
           + "\n").encode("ascii")
    if len(raw) > 1024:
        raise ValueError("Unbounded original prebirth claim")
    return raw


def canonical_birth(claim):
    """Validate a post-creation claim without granting authorization."""
    _exact(claim, _BIRTH)
    if (claim["unit"] != UNIT
            or type(claim["bootId"]) is not str
            or _HEX32.fullmatch(claim["bootId"]) is None
            or type(claim["invocation"]) is not str
            or _HEX32.fullmatch(claim["invocation"]) is None
            or type(claim["nonce"]) is not str
            or _HEX64.fullmatch(claim["nonce"]) is None
            or type(claim["attempt"]) is not int
            or not 0 < claim["attempt"] < 2**63
            or type(claim["restartCount"]) is not int
            or claim["restartCount"] != 0):
        raise ValueError("Invalid unit birth generation")
    for key in ("keeperPid", "keeperTicks", "mountId"):
        if type(claim[key]) is not int or not 0 < claim[key] < 2**63:
            raise ValueError("Invalid birth counter")
    if not 2 <= claim["keeperPid"] <= 2**31 - 1:
        raise ValueError("Invalid unit keeper")
    if (type(claim["mountRoot"]) is not str or claim["mountRoot"] != "/"
            or type(claim["mountDevice"]) is not str
            or re.fullmatch(r"[0-9]+:[0-9]+", claim["mountDevice"]) is None
            or type(claim["ancestry"]) is not list
            or len(claim["ancestry"]) != 3
            or any(type(pair) is not list or len(pair) != 2 or
                   any(type(i) is not int or not 0 < i < 2**63 for i in pair)
                   for pair in claim["ancestry"])):
        raise ValueError("Invalid original mount and cgroup ancestry")
    return (json.dumps(claim, sort_keys=True, separators=(",", ":"))
            + "\n").encode("ascii")


class PrebirthIssuanceContract:
    """Single-use, fail-closed ordering contract with no original authority.

    The future root issuer MUST independently provide: durable prebirth
    publication before service creation; a fenced non-adoption guarantee;
    authenticated manager/kernel birth observations; a persistent quarantine
    and separate controller identity. None is implemented by this class.
    """

    __slots__ = ("_prebirth", "_stage", "_record", "_reason")

    def __init__(self, original, *, unit_absent_before_creation=False,
                 original_durable=False):
        self._stage = "QUARANTINED"
        self._record = None
        self._reason = "UNVERIFIED_INITIAL_ORIGIN"
        raw = canonical_prebirth(original)
        if (unit_absent_before_creation is not True
                or original_durable is not True):
            raise ValueError("No verified pre-birth absence and publication")
        self._prebirth = MappingProxyType(json.loads(raw))
        self._stage = "PREBIRTH"
        self._reason = None

    @property
    def status(self):
        return "UNQUALIFIED_" + self._stage

    @property
    def reason(self):
        return self._reason

    def observe_birth(self, observed):
        if self._stage != "PREBIRTH":
            self.quarantine("REPLAY_OR_UNEXPECTED_BIRTH")
            raise ValueError("Birth already observed or quarantined")
        try:
            canonical = canonical_birth(observed)
            birth = json.loads(canonical)
            if any(birth[key] != self._prebirth[key]
                   for key in ("unit", "bootId", "attempt", "nonce")):
                raise ValueError("Birth contradicts prebirth attempt")
            record = {
                "schemaVersion": 1,
                "unit": birth["unit"],
                "invocation": birth["invocation"],
                "keeperPid": birth["keeperPid"],
                "keeperTicks": birth["keeperTicks"],
                "mountId": birth["mountId"],
                "mountDevice": birth["mountDevice"],
                "mountRoot": birth["mountRoot"],
                "ancestry": birth["ancestry"],
                "attempt": birth["attempt"],
                "nonce": birth["nonce"],
                "sourceSha256": self._prebirth["sourceSha256"],
                "controllerSha256": self._prebirth["controllerSha256"],
            }
            # Require canonical exact sealed-binding shape, not merely a
            # plausible manager invocation or scope string.
            decoded = parse_bootstrap_binding(
                (json.dumps(record, sort_keys=True, separators=(",", ":"))
                 + "\n").encode("ascii"))
            self._record = decoded
            self._stage = "BIRTH_OBSERVED"
            return MappingProxyType({
                "status": "UNQUALIFIED_BIRTH_OBSERVED",
                "record": decoded,
            })
        except Exception:
            self.quarantine("AMBIGUOUS_OR_UNBOUND_BIRTH")
            raise

    def quarantine(self, reason="EXTERNAL_OR_CRASH_UNCERTAINTY"):
        self._stage = "QUARANTINED"
        self._record = None
        self._reason = reason
        return self.status

    def issue_approval(self, *_args, **_kwargs):
        raise PermissionError("GE-04 SECURITY HOLD: no protected original issuer")

    def issue_ack(self, *_args, **_kwargs):
        raise PermissionError("GE-04 SECURITY HOLD: no phase ACK authority")

    def recover(self, *_args, **_kwargs):
        self.quarantine("UNQUALIFIED_RECOVERY")
        raise PermissionError("GE-04 SECURITY HOLD: no original durable recovery")
