"""GE-04 R2S durable TLS endorsement evidence custody — qualification only.

NO production listener, protected anchor writes, worker grants, or security
authorization. TLS peer identities come from the server-side SSLSocket. SQLite
transactions protect against ordinary crashes/concurrent writers, NOT host
administrator rollback, root compromise, or independently trusted identity.
"""
from __future__ import annotations

import hashlib
from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3

_spec = importlib.util.spec_from_file_location(
    "ge04_r2s_roles_for_durable",
    Path(__file__).with_name("ge04-r2s-mtls-dual-role-binding.py"))
_roles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_roles)


def _blocked(reason, **extra):
    return _roles._blocked(reason, **extra)


class DurableEndorsementCustody:
    """Persist one publisher request and one attempted committer endorsement.

    At most one transition from pending->spent may occur. Every outcome remains
    'blocked'; 'rolesBound' is cryptographic transport evidence consistency,
    never a permission to mutate the anchor.
    """

    def __init__(self, db_path, identities, *, anchor_id, epoch):
        if (type(db_path) is not str or not os.path.isabs(db_path)
                or db_path == ":memory:" or type(identities) is not dict
                or type(anchor_id) is not str or type(epoch) is not str
                or _roles.AUDIENCE.fullmatch(anchor_id) is None
                or _roles.AUDIENCE.fullmatch(epoch) is None):
            raise ValueError("invalid durable qualification configuration")
        self.path = db_path
        self._identities = dict(identities)
        self.anchor_id = anchor_id
        self.epoch = epoch

    def _connect(self):
        if os.path.islink(self.path):
            raise ValueError("symlink qualification database denied")
        conn = sqlite3.connect(self.path, timeout=8, isolation_level=None)
        try:
            conn.execute("PRAGMA busy_timeout=8000")
            conn.execute("PRAGMA journal_mode=DELETE")
            conn.execute("PRAGMA synchronous=FULL")
            return conn
        except BaseException:
            conn.close()
            raise

    def initialize(self, *, provision=False):
        """Explicit first-time bootstrap, or strict reopen of existing state."""
        if type(provision) is not bool:
            raise ValueError("invalid provision flag")
        if os.path.islink(self.path):
            raise ValueError("symlink custody database denied")
        if provision:
            if os.path.lexists(self.path):
                raise FileExistsError("existing custody cannot be re-provisioned")
        elif not os.path.isfile(self.path) or os.path.islink(self.path):
            raise FileNotFoundError("custody state absent; never auto-reinitialize")
        with closing(self._connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("""CREATE TABLE IF NOT EXISTS identity (
                singleton INTEGER PRIMARY KEY CHECK (singleton=1),
                anchor_id TEXT NOT NULL, epoch TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS observations (
                request_id TEXT PRIMARY KEY,
                raw BLOB NOT NULL,
                raw_sha256 TEXT NOT NULL,
                publisher_id TEXT NOT NULL,
                publisher_fingerprint TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN ('pending','spent')),
                committer_id TEXT,
                committer_fingerprint TEXT,
                matched INTEGER NOT NULL CHECK (matched IN (0,1)) DEFAULT 0,
                CHECK ((state='pending' AND committer_id IS NULL
                         AND committer_fingerprint IS NULL AND matched=0)
                    OR (state='spent' AND committer_id IS NOT NULL
                         AND committer_fingerprint IS NOT NULL))
            )""")
            existing = conn.execute(
                "SELECT anchor_id, epoch FROM identity WHERE singleton=1").fetchone()
            if existing is None:
                conn.execute("INSERT INTO identity VALUES (1,?,?)",
                             (self.anchor_id, self.epoch))
            elif existing != (self.anchor_id, self.epoch):
                raise ValueError("anchor epoch mismatch; explicit migration required")

    def _request(self, connection, raw, role):
        peer = _roles._peer(connection, self._identities, role)
        if peer is None:
            return None, None, _blocked("unrecognized TLS certificate or role")
        try:
            request = _roles._parse(raw)
        except (ValueError, UnicodeDecodeError, TypeError, OverflowError):
            return None, None, _blocked("invalid bounded request")
        if request["anchorId"] != self.anchor_id or request["epoch"] != self.epoch:
            return None, None, _blocked("wrong anchor target or epoch")
        return peer, request, None

    def _identity_matches(self, conn):
        row = conn.execute(
            "SELECT anchor_id,epoch FROM identity WHERE singleton=1").fetchone()
        if row != (self.anchor_id, self.epoch):
            raise ValueError("durable custody identity mismatch")

    def publisher_observation(self, connection, raw):
        peer, req, error = self._request(connection, raw, "publisher")
        if error is not None:
            return error
        try:
            with closing(self._connect()) as conn, conn:
                conn.execute("BEGIN IMMEDIATE")
                self._identity_matches(conn)
                existing = conn.execute(
                    "SELECT 1 FROM observations WHERE request_id=?",
                    (req["requestId"],)).fetchone()
                if existing:
                    return _blocked("replayed publisher request")
                conn.execute("""INSERT INTO observations(
                    request_id,raw,raw_sha256,publisher_id,publisher_fingerprint,
                    state,committer_id,committer_fingerprint,matched
                ) VALUES (?,?,?,?,?,'pending',NULL,NULL,0)""",
                    (req["requestId"], sqlite3.Binary(raw),
                     hashlib.sha256(raw).hexdigest(), peer[0], peer[1]))
        except (sqlite3.Error, OSError, ValueError, TypeError):
            return _blocked("durable publisher evidence unavailable")
        return _blocked("publisher TLS observation durably recorded; no authority",
                        publisherObserved=True)

    def committer_observation(self, connection, raw, *,
                              simulate_lost_ack=False):
        peer, req, error = self._request(connection, raw, "committer")
        if error is not None:
            return error
        try:
            with closing(self._connect()) as conn, conn:
                conn.execute("BEGIN IMMEDIATE")
                self._identity_matches(conn)
                record = conn.execute("""SELECT raw,raw_sha256,publisher_id,
                    publisher_fingerprint,state FROM observations
                    WHERE request_id=?""", (req["requestId"],)).fetchone()
                if record is None:
                    return _blocked("publisher observation absent")
                stored_raw, stored_sha, publisher_id, publisher_fp, state = record
                if state != "pending":
                    return _blocked("endorsement already consumed")
                # Consumption is durable in the SAME transaction as the
                # endorsement evidence. Even mismatch/rejection spends the ID.
                matched = (stored_raw == raw
                           and stored_sha == hashlib.sha256(raw).hexdigest()
                           and publisher_id != peer[0]
                           and publisher_fp != peer[1])
                conn.execute("""UPDATE observations SET state='spent',
                    committer_id=?, committer_fingerprint=?,matched=?
                    WHERE request_id=? AND state='pending'""",
                    (peer[0], peer[1], int(matched), req["requestId"]))
            if simulate_lost_ack:
                return _blocked("endorsement outcome unknown; reconcile durable evidence")
            if not matched:
                return _blocked("publisher/committer identity or bytes mismatch")
        except (sqlite3.Error, OSError, ValueError, TypeError):
            return _blocked("durable endorsement evidence unavailable")
        return _blocked("durable two-role observation only; no authority",
                        rolesBound=True, proposalSha256=req["proposalSha256"])

    def inspect(self, request_id):
        """Non-authoritative observation only; never expose an allow decision."""
        if type(request_id) is not str or _roles.TOKEN.fullmatch(request_id) is None:
            return _blocked("invalid request identifier")
        try:
            with closing(self._connect()) as conn, conn:
                self._identity_matches(conn)
                record = conn.execute("""SELECT state,matched FROM observations
                    WHERE request_id=?""", (request_id,)).fetchone()
                if record is None:
                    return _blocked("request not observed")
                return _blocked("untrusted durable observation, not authority",
                                observationState=record[0],
                                rolesBound=record[0]=="spent" and record[1]==1)
        except (sqlite3.Error, OSError, ValueError, TypeError):
            return _blocked("durable evidence unavailable")
