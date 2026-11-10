"""GE-04 read-only phase controller prototype; never emits an ACK.

This reconciles a fixed original receipt, native phase diagnostics, and a
read-only manager/kernel witness per event. It cannot authenticate pre-birth
record provenance or independently hold the root bootstrap's unit/namespace.
No authority, root access, cgroup mutation, worker admission or IPC writer.
"""
import re
import json
import time
from types import MappingProxyType
from collections.abc import Mapping

from bootstrap_binding import UNIT, FIELDS, parse_bootstrap_binding
from unit_kernel_observer import observe_manager_and_kernel

PHASES = ("INTENT", "PRE_NAMESPACE", "PINNED", "ENABLED", "PRE_JOIN", "READY")
TERMINAL = frozenset(("EMPTY", "DENIED"))
DIAGNOSTIC = re.compile(
    rb"EV (INTENT|PRE_NAMESPACE|PINNED|ENABLED|PRE_JOIN|READY|EMPTY|DENIED)"
    rb" (0|[1-9][0-9]{0,9}) (0|[1-9][0-9]{0,19})"
    rb" (0|[1-9][0-9]{0,9}) (0|[1-9][0-9]{0,19})\n"
)
MAX_PID = 2**31 - 1
MAX_TICKS = 2**64 - 1


def decode_native_event(raw):
    """Closed bounded native diagnostic grammar, never proof of PID custody."""
    if type(raw) is not bytes or not 0 < len(raw) <= 144:
        raise ValueError("Unbounded native diagnostic")
    match = DIAGNOSTIC.fullmatch(raw)
    if match is None:
        raise ValueError("Malformed native diagnostic")
    phase = match.group(1).decode("ascii")
    values = tuple(int(field) for field in match.groups()[1:])
    for pid, ticks in ((values[0], values[1]), (values[2], values[3])):
        if (pid > MAX_PID or ticks > MAX_TICKS
                or (pid == 0) != (ticks == 0)):
            raise ValueError("Unbound diagnostic process generation")
    if values[0] and values[0] == values[2]:
        raise ValueError("Duplicate native process generation")
    return phase, values


def _exact_original(record):
    # Canonical parser validates ALL original identity fields, including source
    # digests and nonce. This is shape validation, never provenance.
    if type(record) is not dict or frozenset(record) != FIELDS:
        raise ValueError("Incomplete original qualification intent")
    try:
        normalized = dict(record)
        if type(normalized["ancestry"]) is tuple:
            normalized["ancestry"] = [list(pair) for pair in normalized["ancestry"]]
        raw = (json.dumps(normalized, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True) + "\n").encode("ascii")
        return dict(parse_bootstrap_binding(raw))
    except (TypeError, UnicodeError, ValueError) as exc:
        raise ValueError("Invalid original qualification intent") from exc


class ReadOnlyPhaseController:
    """Single-run fail-closed diagnostic state machine; no privileged ACK.

    The original is caller supplied, NOT independently authenticated. A real
    root authority must own protected pre-birth evidence and kernel witnesses
    and must never adopt this object as an authorization implementation.
    """

    __slots__ = ("_original", "_observe", "_phase_index", "_terminal",
                 "_quarantined", "_records", "_limit")

    def __init__(self, original, observer=None, maximum_events=8):
        self._original = _exact_original(original)
        if observer is None:
            observer = observe_manager_and_kernel
        if not callable(observer) or type(maximum_events) is not int or maximum_events != 8:
            raise ValueError("Unsupported observer or event budget")
        self._observe = observer
        self._phase_index = 0
        self._terminal = None
        self._quarantined = False
        self._records = []
        self._limit = maximum_events

    @property
    def status(self):
        return "QUARANTINE_PENDING_INDEPENDENT_RECOVERY" if self._quarantined else (
            "UNQUALIFIED_TERMINAL_OBSERVATION" if self._terminal else
            "UNQUALIFIED_PHASE_OBSERVATION")

    @property
    def evidence(self):
        return tuple(self._records)

    def accept(self, raw, deadline):
        """Observe and record only. A failure poisons this instance.

        deadline is an absolute monotonic time supplied by the owner. The
        observer must be bounded externally; this prototype cannot interrupt
        a stuck callback, so it must not be connected to a privileged loop.
        """
        if self._quarantined or self._terminal:
            raise ValueError("Terminal or quarantined phase controller")
        try:
            if (type(deadline) not in (int, float)
                    or not time.monotonic() < deadline
                    or len(self._records) >= self._limit):
                raise ValueError("Expired or exhausted diagnostic window")
            phase, claims = decode_native_event(raw)
            if phase == "DENIED":
                self._quarantined = True
                self._terminal = phase
                self._records.append(MappingProxyType({
                    "phase": phase, "claims": claims,
                    "status": "QUARANTINE_PENDING_INDEPENDENT_RECOVERY",
                }))
                return self.status
            if phase == "EMPTY":
                if self._phase_index == 0:
                    raise ValueError("Unbound empty terminal")
            elif (self._phase_index >= len(PHASES)
                  or PHASES[self._phase_index] != phase):
                raise ValueError("Unexpected or replayed phase")
            # This is genuine read-only corroboration when the real observer
            # is used; neither caller-supplied record nor callback is trusted.
            witness = self._observe(self._original.copy())
            if not isinstance(witness, Mapping) or witness.get("status") != (
                    "UNQUALIFIED_MANAGER_KERNEL_CORRELATION"):
                raise ValueError("Unqualified or missing kernel witness")
            if type(witness.get("managerOwner")) is not str or not witness["managerOwner"]:
                raise ValueError("Missing manager owner")
            kernel = witness.get("kernel")
            if (not isinstance(kernel, Mapping)
                    or kernel.get("status") != "UNQUALIFIED_KERNEL_UNIT_CORRELATION"
                    or kernel.get("pid") != self._original["keeperPid"]
                    or kernel.get("startticks") != self._original["keeperTicks"]):
                raise ValueError("Kernel keeper mismatch")
            if not time.monotonic() < deadline:
                raise ValueError("Observation expired")
            self._records.append(MappingProxyType({
                "phase": phase, "claims": claims,
                "status": "UNQUALIFIED_PHASE_OBSERVATION",
                "managerOwner": witness["managerOwner"],
            }))
            if phase == "EMPTY":
                # No independent descendant-empty, cleanup or recovery proof.
                # An EMPTY diagnostic is never a release or positive ACK.
                self._terminal = "EMPTY"
                self._quarantined = True
            else:
                self._phase_index += 1
            return self.status
        except Exception:
            self._quarantined = True
            raise

    def issue_ack(self, *_args, **_kwargs):
        """Unconditional refusal: only a future reviewed controller may ACK."""
        raise PermissionError("GE-04 SECURITY HOLD: no authenticated ACK authority")
