"""GE-04 R2S mTLS-bound dual-role *qualification recorder*, NOT authorization.

No production routes, no durable role custody and no anchor mutation. Peers
are identified only from TLS-verified SSLSocket certificate fingerprints using
an independently provisioned mapping (the caller supplies that mapping here).
The process-local request journal is deliberately not durable. Even matching
publisher and committer evidence MUST NOT be interpreted as permission.
"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import threading

MAX_REQUEST = 8192
TOKEN = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
AUDIENCE = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
SCHEMA = "ge04-r2s-two-role-v1"
FIELDS = {"schema", "requestId", "anchorId", "epoch", "proposalSha256",
          "expectedRevision", "expectedHeadSha256"}


def _parse(raw: bytes) -> dict:
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_REQUEST:
        raise ValueError("request body missing or oversized")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    def no_constant(_):
        raise ValueError("non-finite JSON value")
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                      parse_constant=no_constant)
    if type(data) is not dict or set(data) != FIELDS or data["schema"] != SCHEMA:
        raise ValueError("invalid two-role request schema")
    for key in ("requestId",):
        if type(data[key]) is not str or TOKEN.fullmatch(data[key]) is None:
            raise ValueError("invalid idempotency token")
    for key in ("anchorId", "epoch"):
        if type(data[key]) is not str or AUDIENCE.fullmatch(data[key]) is None:
            raise ValueError("invalid anchor identity or epoch")
    for key in ("proposalSha256", "expectedHeadSha256"):
        if type(data[key]) is not str or HEX64.fullmatch(data[key]) is None:
            raise ValueError("invalid proposal digest")
    revision = data["expectedRevision"]
    if type(revision) is not int or not 0 <= revision <= 2**53 - 1:
        raise ValueError("invalid expected revision")
    if revision == 0 and data["expectedHeadSha256"] != "0"*64:
        raise ValueError("invalid genesis reference")
    return data


def _peer(connection, mapping: dict, expected_role: str):
    if not isinstance(connection, ssl.SSLSocket) or type(mapping) is not dict:
        return None
    try:
        certificate = connection.getpeercert(binary_form=True)
    except (ssl.SSLError, OSError, ValueError):
        return None
    if not certificate:
        return None
    fingerprint = hashlib.sha256(certificate).hexdigest()
    identity = mapping.get(fingerprint)
    if (type(identity) is not tuple or len(identity) != 2
            or type(identity[0]) is not str or not identity[0]
            or identity[1] != expected_role):
        return None
    return (identity[0], fingerprint)


def _blocked(reason: str, **details) -> dict:
    return {"status": "blocked", "securityHoldActive": True,
            "authorizationGranted": False, "rollbackResistant": False,
            "independentAuthorityQualified": False, "reason": reason, **details}


class QualificationDualRoleBinder:
    """Two authenticated TLS observations matched by exact request bytes.

    The Python object intentionally has no commit/store/signer reference.
    Production would require authenticated non-exportable identities, durable
    endorsements, nonce custody and a protected atomic anchor before invoking
    an *independent* committer. Here, success means observations are consistent
    ONLY, not that either principal is authorized for real checkpoints.
    """

    def __init__(self, identities: dict, *, anchor_id: str, epoch: str):
        if type(identities) is not dict or type(anchor_id) is not str or type(epoch) is not str:
            raise ValueError("invalid qualification binder")
        if AUDIENCE.fullmatch(anchor_id) is None or AUDIENCE.fullmatch(epoch) is None:
            raise ValueError("invalid anchor target")
        self._identities = dict(identities)
        self._anchor_id = anchor_id
        self._epoch = epoch
        self._pending: dict[str, tuple[bytes, str, str]] = {}
        self._spent: set[str] = set()
        self._lock = threading.Lock()

    def publisher_observation(self, connection, raw: bytes) -> dict:
        peer = _peer(connection, self._identities, "publisher")
        if peer is None:
            return _blocked("publisher certificate unrecognized or wrong role")
        try:
            request = _parse(raw)
        except (ValueError, UnicodeDecodeError, TypeError, OverflowError):
            return _blocked("malformed publisher request")
        if request["anchorId"] != self._anchor_id or request["epoch"] != self._epoch:
            return _blocked("wrong anchor or epoch")
        request_id = request["requestId"]
        with self._lock:
            if request_id in self._spent or request_id in self._pending:
                return _blocked("duplicate or replayed proposal id")
            self._pending[request_id] = (raw, peer[0], peer[1])
        return _blocked("publisher TLS observation recorded; no authority",
                        publisherObserved=True)

    def committer_observation(self, connection, raw: bytes) -> dict:
        peer = _peer(connection, self._identities, "committer")
        if peer is None:
            return _blocked("committer certificate unrecognized or wrong role")
        try:
            request = _parse(raw)
        except (ValueError, UnicodeDecodeError, TypeError, OverflowError):
            return _blocked("malformed committer request")
        if request["anchorId"] != self._anchor_id or request["epoch"] != self._epoch:
            return _blocked("wrong anchor or epoch")
        request_id = request["requestId"]
        with self._lock:
            if request_id in self._spent:
                return _blocked("endorsement replay")
            pending = self._pending.get(request_id)
            if pending is None:
                return _blocked("no publisher observation")
            previous_raw, publisher, publisher_fingerprint = pending
            # An attempted endorsement, including mismatch, consumes this
            # process-local token; never silently retry with altered bytes.
            del self._pending[request_id]
            self._spent.add(request_id)
            if previous_raw != raw:
                return _blocked("publisher/committer request bytes mismatch")
            if publisher == peer[0] or publisher_fingerprint == peer[1]:
                return _blocked("publisher and committer identities not separated")
        return _blocked("two mTLS peer observations consistent, still not authority",
                        rolesBound=True, proposalSha256=request["proposalSha256"])
