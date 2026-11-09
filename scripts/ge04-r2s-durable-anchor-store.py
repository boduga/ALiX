"""GE-04 R2S durable SQLite anchor *qualification simulator*, NOT external trust.

No listener, no signing/private keys, no policy decision, no worker authorization.
Host SQLite files are rollbackable by their administrator. This module must not
be wired as the production independent monotonic anchor.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
from typing import Any

_spec = importlib.util.spec_from_file_location(
    "ge04_r2s_anchor_protocol_store", Path(__file__).with_name("ge04-r2s-anchor-protocol.py"))
_protocol = importlib.util.module_from_spec(_spec)
import sys
sys.modules[_spec.name] = _protocol
_spec.loader.exec_module(_protocol)

TOKEN = re.compile(r"[a-zA-Z0-9_-]{12,128}\Z")


def _payload(head: dict) -> str:
    return _protocol.canonical(head).decode("ascii")


def _blocked(reason: str) -> dict:
    return {"status": "blocked", "reason": reason,
            "authorizationGranted": False, "securityHoldActive": True}


class DurableQualificationAnchor:
    """Crash-restart SQLite CAS; caller-supplied role labels are NOT authentication.

    A real independently operated monotonic service must implement its own
    authorization from mTLS principals and protect journal state outside
    the witness VM + backup/rollback domain.
    """

    def __init__(self, db_path: str, *, anchor_id: str, epoch: str,
                 signer_key_sha256: str):
        if (type(db_path) is not str or not db_path or db_path == ":memory:"
                or not os.path.isabs(db_path)):
            raise ValueError("qualification anchor requires absolute persistent db path")
        if (type(anchor_id) is not str or type(epoch) is not str or
                not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", anchor_id) or
                not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", epoch) or
                type(signer_key_sha256) is not str or
                _protocol.HEX.fullmatch(signer_key_sha256) is None):
            raise ValueError("invalid pinned anchor identity")
        self.path = db_path
        self.anchor_id = anchor_id
        self.epoch = epoch
        self.signer_key_sha256 = signer_key_sha256

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=6, isolation_level=None)
        conn.execute("PRAGMA busy_timeout=6000")
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def initialize(self) -> None:
        """Create once, never silently replace existing pinned metadata."""
        if os.path.islink(self.path):
            raise PermissionError("symlink database not allowed")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("""CREATE TABLE IF NOT EXISTS identity (
                singleton INTEGER PRIMARY KEY CHECK (singleton=1),
                anchor_id TEXT NOT NULL, epoch TEXT NOT NULL,
                signer_key_sha256 TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS heads (
                revision INTEGER PRIMARY KEY CHECK (revision>0),
                head_sha256 TEXT UNIQUE NOT NULL,
                head_json TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS requests (
                request_id TEXT PRIMARY KEY,
                proposal_sha256 TEXT NOT NULL,
                revision INTEGER NOT NULL REFERENCES heads(revision),
                head_sha256 TEXT NOT NULL)""")
            current = conn.execute(
                "SELECT anchor_id,epoch,signer_key_sha256 FROM identity WHERE singleton=1"
            ).fetchone()
            expected = (self.anchor_id, self.epoch, self.signer_key_sha256)
            if current is None:
                conn.execute("INSERT INTO identity VALUES (1,?,?,?)", expected)
            elif current != expected:
                raise ValueError("anchor identity mismatch: explicit recovery required")
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _head(self, conn: sqlite3.Connection) -> tuple[dict | None, str]:
        row = conn.execute(
            "SELECT revision,head_sha256,head_json FROM heads ORDER BY revision DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None, _protocol.GENESIS
        revision, stored_digest, data = row
        try:
            head = json.loads(data)
            _protocol.validate_head(head)
            if head["revision"] != revision or _protocol.digest(head) != stored_digest:
                raise ValueError("corrupted protected head")
            if (head["anchorId"],head["epoch"],head["signerKeySha256"]) != (
                self.anchor_id,self.epoch,self.signer_key_sha256):
                raise ValueError("head identity mismatch")
        except (TypeError, ValueError, KeyError) as exc:
            raise ValueError("untrusted durable anchor state") from exc
        return head, stored_digest

    def read_head(self) -> dict:
        """Read only; no trust/provenance qualification or authorization."""
        if os.path.islink(self.path):
            return _blocked("database symlink rejected")
        try:
            with self._connect() as conn:
                identity = conn.execute(
                    "SELECT anchor_id,epoch,signer_key_sha256 FROM identity WHERE singleton=1"
                ).fetchone()
                if identity != (self.anchor_id,self.epoch,self.signer_key_sha256):
                    return _blocked("identity mismatch")
                head, sha = self._head(conn)
                return {"status": "observed-qualification-only",
                        "revision": head["revision"] if head else 0,
                        "headSha256": sha, "head": head,
                        "authorizationGranted": False, "securityHoldActive": True,
                        "rollbackResistant": False}
        except (OSError, sqlite3.Error, ValueError, TypeError):
            return _blocked("anchor unavailable or corrupted")

    def commit(self, *, head: Any, expected_revision: int,
               expected_head_sha256: str, request_id: str,
               asserted_role: str, publisher: str,
               publisher_allowlist: frozenset[str],
               simulate_lost_ack: bool = False) -> dict:
        """Exactly-once request ID + atomic head CAS; roles are fake fixture inputs.

        A duplicate request with identical payload returns an observation of the
        earlier commit, never a fresh security grant. A changed payload sharing
        the same request ID is rejected. An ambiguous response is always blocked.
        """
        if (asserted_role != "committer" or
                type(publisher) is not str or publisher not in publisher_allowlist):
            return _blocked("role not authorized (qualification only)")
        if (type(request_id) is not str or TOKEN.fullmatch(request_id) is None or
                type(expected_revision) is not int or expected_revision < 0 or
                type(expected_head_sha256) is not str or
                _protocol.HEX.fullmatch(expected_head_sha256) is None):
            return _blocked("invalid request identity")
        try:
            _protocol.validate_head(head)
        except (ValueError, TypeError, KeyError):
            return _blocked("invalid proposed head")
        if (head["anchorId"], head["epoch"], head["signerKeySha256"]) != (
                self.anchor_id, self.epoch, self.signer_key_sha256):
            return _blocked("anchor epoch or key substitution")
        fingerprint = hashlib.sha256(_protocol.DOMAIN + _protocol.canonical({
            "requestId":request_id,"publisher":publisher,
            "expectedRevision":expected_revision,
            "expectedHeadSha256":expected_head_sha256,"head":head})).hexdigest()
        if os.path.islink(self.path):
            return _blocked("database symlink rejected")
        try:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                identity = conn.execute(
                    "SELECT anchor_id,epoch,signer_key_sha256 FROM identity WHERE singleton=1"
                ).fetchone()
                if identity != (self.anchor_id,self.epoch,self.signer_key_sha256):
                    raise ValueError("identity mismatch")
                prior = conn.execute(
                    "SELECT proposal_sha256,revision,head_sha256 FROM requests WHERE request_id=?",
                    (request_id,)).fetchone()
                if prior is not None:
                    if prior[0] != fingerprint:
                        conn.rollback()
                        return _blocked("request id reused with different proposal")
                    head_now, sha_now = self._head(conn)
                    if head_now is None or head_now["revision"] < prior[1] or (
                            head_now["revision"] == prior[1] and sha_now != prior[2]):
                        raise ValueError("idempotency record inconsistent with head")
                    conn.commit()
                    return {"status": "previously-recorded-qualification-only",
                            "revision": prior[1], "headSha256": prior[2],
                            "authorizationGranted": False,"securityHoldActive": True}
                current, current_sha = self._head(conn)
                revision = current["revision"] if current else 0
                if (expected_revision != revision or expected_head_sha256 != current_sha or
                        head["revision"] != revision+1 or
                        head["previousHeadSha256"] != current_sha or
                        revision >= _protocol.MAX_REVISION):
                    conn.rollback()
                    return _blocked("stale, forked or invalid advance")
                new_sha = _protocol.digest(head)
                conn.execute("INSERT INTO heads VALUES (?,?,?)",
                             (head["revision"], new_sha, _payload(head)))
                conn.execute("INSERT INTO requests VALUES (?,?,?,?)",
                             (request_id, fingerprint, head["revision"], new_sha))
                conn.commit()
                if simulate_lost_ack:
                    return _blocked("commit outcome unknown; read protected head")
                return {"status": "recorded-qualification-only",
                        "revision": head["revision"], "headSha256": new_sha,
                        "authorizationGranted": False,"securityHoldActive": True}
            except BaseException:
                conn.rollback()
                raise
            finally:
                conn.close()
        except (sqlite3.Error, OSError, ValueError, TypeError):
            return _blocked("durable state unavailable or inconsistent")
