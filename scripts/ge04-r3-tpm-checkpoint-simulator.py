"""GE-04 R3 TPM2A: deterministic checkpoint crash-model, NO actual TPM I/O.

SQLite is rollbackable; the externally supplied *simulated* NV Extend object
is separate from it. This is not a production trusted anchor or authorization.
The model intentionally never automatically retries a possibly extended intent.
"""
from __future__ import annotations

from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import threading

_spec = importlib.util.spec_from_file_location(
    "r3_tpm2a_anchor_protocol", Path(__file__).with_name("ge04-r2s-anchor-protocol.py"))
import sys
_protocol = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _protocol
_spec.loader.exec_module(_protocol)

ZERO = bytes(32)
DOMAIN = b"ALIX-GE04-R3-TPM-EXTEND-V1\0"


def _deny(reason, **extra):
    return dict(status="blocked", securityHoldActive=True,
                authorizationGranted=False, rollbackResistant=False,
                independentAuthorityQualified=False, reason=reason, **extra)


def _extend_digest(current: bytes, head_digest: str) -> bytes:
    if (type(current) is not bytes or len(current) != 32
            or type(head_digest) is not str or
            _protocol.HEX.fullmatch(head_digest) is None):
        raise ValueError("invalid simulated extend input")
    # Domain-separate the proposed head commitment before the TPM transition.
    extend_input = hashlib.sha256(DOMAIN + bytes.fromhex(head_digest)).digest()
    return hashlib.sha256(current + extend_input).digest()


class SimulatedNVExtend:
    """In-memory hardware state, intentionally not reconstructible from DB.

    This is NOT TPM emulation, provisioning, or an independent administration
    domain. Simulator identity is externally supplied and immutable per object.
    """
    def __init__(self, *, nv_name: str, state: bytes = ZERO):
        if (type(nv_name) is not str or not nv_name
                or type(state) is not bytes or len(state) != 32):
            raise ValueError("invalid simulated NV identity/state")
        self.name = nv_name
        self._state = state
        self._lock = threading.Lock()

    def read(self) -> bytes:
        with self._lock:
            return self._state

    def extend(self, head_digest: str) -> bytes:
        with self._lock:
            self._state = _extend_digest(self._state, head_digest)
            return self._state


class QualificationTPMCheckpoint:
    """Two-phase journal with external simulated NV state and strict rechecks.

    prepare: durable intent only; execute_hardware: simulated extend only;
    reconcile: compare NV to expected old/new before finalizing local journal.
    A crash never causes an automatic second NV extend.
    """

    def __init__(self, db_path: str, nv: SimulatedNVExtend, *,
                 anchor_id: str, epoch: str):
        if (type(db_path) is not str or not os.path.isabs(db_path) or
                type(anchor_id) is not str or type(epoch) is not str or
                not 1 <= len(anchor_id) <= 128 or
                not 1 <= len(epoch) <= 128 or
                not all(c.isascii() and (c.isalnum() or c in "_.:-") for c in anchor_id+epoch)
                or not isinstance(nv, SimulatedNVExtend)):
            raise ValueError("invalid simulated anchor configuration")
        self.path = db_path
        self.nv = nv
        self.anchor_id = anchor_id
        self.epoch = epoch

    def _connect(self):
        if os.path.islink(self.path) or not os.path.isfile(self.path):
            raise ValueError("absent/symlinked journal: do not initialize implicitly")
        conn = sqlite3.connect(self.path, timeout=6, isolation_level=None)
        conn.execute("PRAGMA busy_timeout=6000")
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=FULL")
        return conn

    def provision_fixture(self):
        """Explicit test bootstrap only, never execute on a real TPM."""
        if os.path.lexists(self.path):
            raise ValueError("journal exists: cannot reprovision")
        if self.nv.read() != ZERO:
            raise ValueError("NV already initialized: cannot bootstrap")
        conn = sqlite3.connect(self.path, isolation_level=None)
        try:
            conn.execute("PRAGMA journal_mode=DELETE")
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("""CREATE TABLE identity (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                anchor_id TEXT NOT NULL, epoch TEXT NOT NULL, nv_name TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE records (
                revision INTEGER PRIMARY KEY CHECK(revision>0),
                request_id TEXT NOT NULL UNIQUE,
                head_json TEXT NOT NULL,
                head_sha256 TEXT NOT NULL,
                expected_old TEXT NOT NULL,
                expected_new TEXT NOT NULL,
                phase TEXT NOT NULL CHECK(phase IN ('prepared','extended','committed')))""")
            conn.execute("INSERT INTO identity VALUES (1,?,?,?)",
                         (self.anchor_id, self.epoch, self.nv.name))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _records(self, conn):
        identity = conn.execute(
            "SELECT anchor_id,epoch,nv_name FROM identity WHERE singleton=1").fetchone()
        if identity != (self.anchor_id, self.epoch, self.nv.name):
            raise ValueError("fixture identity substitution")
        records = conn.execute("""SELECT revision,request_id,head_json,
            head_sha256,expected_old,expected_new,phase FROM records
            ORDER BY revision""").fetchall()
        prior_head = _protocol.GENESIS
        prior_nv = ZERO
        for number, row in enumerate(records, start=1):
            revision, request_id, raw, digest, old, new, phase = row
            head = json.loads(raw)
            _protocol.validate_head(head)
            if (revision != number or head["revision"] != number or
                    head["anchorId"] != self.anchor_id or
                    head["epoch"] != self.epoch or
                    head["previousHeadSha256"] != prior_head or
                    _protocol.digest(head) != digest or
                    raw != _protocol.canonical(head).decode("ascii") or
                    old != prior_nv.hex() or
                    new != _extend_digest(prior_nv, digest).hex()):
                raise ValueError("journal chain or NV commitment tampered")
            if number != len(records) and phase != "committed":
                raise ValueError("nonterminal pending intent")
            prior_nv = bytes.fromhex(new)
            prior_head = digest
        return records

    def _inspect(self, conn):
        records = self._records(conn)
        state = self.nv.read()
        if not records:
            if state != ZERO:
                raise ValueError("NV differs from empty journal (rollback/reset)")
            return records
        latest = records[-1]
        old, new, phase = bytes.fromhex(latest[4]), bytes.fromhex(latest[5]), latest[6]
        if phase in ("committed", "extended") and state != new:
            raise ValueError("TPM differs from reported extended journal")
        if phase == "prepared" and state not in (old, new):
            raise ValueError("TPM diverged from pending transition")
        return records

    def inspect(self):
        try:
            with closing(self._connect()) as conn:
                records = self._inspect(conn)
                pending = bool(records and records[-1][6] != "committed")
                return _deny("checkpoint evidence only, no grant",
                             journalConsistent=True, pending=pending,
                             revision=records[-1][0] if records else 0,
                             nvDigest=self.nv.read().hex())
        except (sqlite3.Error, ValueError, OSError, TypeError, UnicodeError):
            return _deny("journal/NV mismatch or unavailable", journalConsistent=False)

    def prepare(self, head: dict, request_id: str):
        try:
            _protocol.validate_head(head)
            if (type(request_id) is not str or
                    not 16 <= len(request_id) <= 128 or
                    not all(c.isascii() and (c.isalnum() or c in "_-") for c in request_id)):
                raise ValueError("invalid request ID")
            if (head["anchorId"], head["epoch"]) != (self.anchor_id, self.epoch):
                raise ValueError("anchor identity mismatch")
            with closing(self._connect()) as conn:
                conn.execute("BEGIN IMMEDIATE")
                records = self._inspect(conn)
                if records and records[-1][6] != "committed":
                    raise ValueError("unresolved intent")
                current_revision = records[-1][0] if records else 0
                previous = records[-1][3] if records else _protocol.GENESIS
                if (head["revision"] != current_revision + 1 or
                        head["previousHeadSha256"] != previous or
                        head["revision"] > _protocol.MAX_REVISION):
                    raise ValueError("stale/forked head")
                old = self.nv.read()
                head_digest = _protocol.digest(head)
                conn.execute("INSERT INTO records VALUES (?,?,?,?,?,?,?)",
                             (head["revision"], request_id,
                              _protocol.canonical(head).decode("ascii"), head_digest,
                              old.hex(), _extend_digest(old, head_digest).hex(), "prepared"))
                conn.commit()
            return _deny("intent persisted; no hardware executed", intentPrepared=True)
        except (sqlite3.Error, ValueError, OSError, TypeError):
            return _deny("preparation failed")

    def execute_simulated_extend(self, request_id: str, *, lose_ack=False):
        """Test-only hardware step. This method MUST NEVER wire to real TPM."""
        try:
            with closing(self._connect()) as conn:
                conn.execute("BEGIN IMMEDIATE")
                records = self._inspect(conn)
                if not records or records[-1][1] != request_id:
                    raise ValueError("unknown request")
                latest = records[-1]
                if latest[6] != "prepared" or self.nv.read().hex() != latest[4]:
                    raise ValueError("ambiguous or already applied operation")
                self.nv.extend(latest[3])
                if lose_ack:
                    return _deny("simulated extend outcome unknown")
                # A crash here leaves prepared but NV advanced. Reconcile.
                conn.execute("UPDATE records SET phase='extended' WHERE revision=?",
                             (latest[0],))
                conn.commit()
            return _deny("simulated NV advanced; reconciliation required", extended=True)
        except (sqlite3.Error, ValueError, OSError, TypeError):
            return _deny("hardware step unavailable or ambiguous")

    def reconcile(self):
        """Read NV and journal; never replay an uncertain hardware operation."""
        try:
            with closing(self._connect()) as conn:
                conn.execute("BEGIN IMMEDIATE")
                records = self._inspect(conn)
                if not records:
                    return _deny("empty journal; nothing to reconcile")
                latest = records[-1]
                if latest[6] == "committed":
                    return _deny("already reconciled; no permission", revision=latest[0])
                if self.nv.read().hex() == latest[4]:
                    return _deny("prepared, hardware not advanced; manual abort/recovery required")
                if self.nv.read().hex() != latest[5]:
                    raise ValueError("unknown NV state")
                conn.execute("UPDATE records SET phase='committed' WHERE revision=?",
                             (latest[0],))
                conn.commit()
            return _deny("simulated NV and SQLite reconciled; no authorization",
                         reconciled=True, revision=latest[0])
        except (sqlite3.Error, ValueError, OSError, TypeError):
            return _deny("reconciliation blocked: NV or journal mismatch")
