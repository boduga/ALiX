#!/usr/bin/env python3
"""GE-04-R2Q qualification-only monotonic witness.

Local root operator writes a SQLite revision head, read-only service signs
nonce-bound head queries. No HTTP mutation endpoint, admission, recovery,
production policy, or independently rollback-resistant authority.

The root administrator can still restore a VM snapshot, including state and
key. Thus rollbackResistant and witnessAuthorityQualified remain FALSE.
"""
from __future__ import annotations
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import importlib.util
import ssl
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SCHEMA = "ge04-r2p-witness-v1"
HEX64 = re.compile(r"[a-f0-9]{64}")
WITNESS_ID = "alix-ge04-r2q-qualifier"
MAX_BODY = 1024
BIND = "127.0.0.1"
PORT = 18841


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def validate_digest(x):
    if type(x) is not str or not HEX64.fullmatch(x):
        raise ValueError("expected lowercase SHA-256 hex")


def require_root():
    if os.geteuid() != 0:
        raise PermissionError("only isolated operator root may modify witness state")


def _db(path, *, write=False):
    if write:
        return sqlite3.connect(path, timeout=3)
    # SQLite read-only on a root-owned stable DB. No writable sidecars required.
    return sqlite3.connect("file:" + str(Path(path).resolve()) + "?mode=ro", uri=True, timeout=3)


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS head (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        revision INTEGER NOT NULL CHECK(revision>0),
        policy_sha256 TEXT NOT NULL,
        checkpoint_sha256 TEXT NOT NULL
    )""")


def initialize(db_path, key_path, public_path):
    require_root()
    for p in (db_path, key_path, public_path):
        if os.path.lexists(p):
            raise FileExistsError("refusing reinitialization of existing witness")
    private = Ed25519PrivateKey.generate()
    key = private.private_bytes(serialization.Encoding.Raw,
                                serialization.PrivateFormat.Raw,
                                serialization.NoEncryption())
    pub = private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    # Caller must pre-provision protected directories. No overwrites.
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, key)
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(public_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        os.write(fd, pub.hex().encode("ascii") + b"\n")
        os.fsync(fd)
    finally:
        os.close(fd)
    with _db(db_path, write=True) as conn:
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=FULL")
        ensure_schema(conn)
    os.chmod(db_path, 0o640)
    return pub.hex()


def append_head(db_path, revision, policy, checkpoint):
    """Offline-only; strictly serializable compare-and-swap revision."""
    require_root()
    validate_digest(policy)
    validate_digest(checkpoint)
    if type(revision) is not int or revision <= 0:
        raise ValueError("invalid revision")
    with _db(db_path, write=True) as conn:
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT revision FROM head WHERE singleton=1").fetchone()
        expected = (row[0] + 1) if row else 1
        if revision != expected:
            raise ValueError("rollback, revision gap or duplicate revision")
        if row:
            conn.execute("UPDATE head SET revision=?, policy_sha256=?, checkpoint_sha256=? WHERE singleton=1",
                         (revision, policy, checkpoint))
        else:
            conn.execute("INSERT INTO head VALUES (1, ?, ?, ?)", (revision, policy, checkpoint))
    return revision


def read_head(db_path):
    with _db(db_path) as conn:
        row = conn.execute("SELECT revision,policy_sha256,checkpoint_sha256 FROM head WHERE singleton=1").fetchone()
    if row is None:
        raise ValueError("witness unprovisioned")
    return row


def load_signer(path):
    st = os.lstat(path)
    # Root-owned immutable-to-service key with group read is supported.
    # Owner-only 0600 is also valid for isolated test fixtures.
    mode = stat.S_IMODE(st.st_mode)
    group_read = (st.st_uid == 0 and st.st_gid == os.getegid()
                  and mode == 0o640)
    if (not stat.S_ISREG(st.st_mode) or st.st_size != 32
            or not (mode == 0o600 or group_read)):
        raise PermissionError("unsafe signing key")
    with open(path, "rb") as f:
        key = f.read(33)
    if len(key) != 32:
        raise ValueError("unsafe signing key length")
    return Ed25519PrivateKey.from_private_bytes(key)


def handler_factory(db_path, signer, *, authorize=None):
    class Handler(BaseHTTPRequestHandler):
        def _authorized(self):
            if authorize is None:
                return True  # R2Q loopback-only legacy qualification
            if not authorize(self.connection, self.command, self.path):
                self.send_json(403, {"status": "blocked"})
                return False
            return True
        def do_GET(self):
            if not self._authorized():
                return
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_json(200, {"service": "GE04_R2Q", "status": "qualification-only",
                                 "authorization": False})
        def do_POST(self):
            if not self._authorized():
                return
            if self.path != "/challenge":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "-1"))
                if length < 1 or length > MAX_BODY:
                    raise ValueError("invalid body length")
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(data, dict) or set(data) != {"nonce", "bootId"}:
                    raise ValueError("unknown challenge")
                nonce, boot = data["nonce"], data["bootId"]
                validate_digest(nonce)
                if type(boot) is not str or not 1 <= len(boot) <= 100 or any(
                    not (x.isalnum() or x in "-_") for x in boot):
                    raise ValueError("invalid boot")
                rev, policy, checkpoint = read_head(db_path)
                payload = {"schema": SCHEMA, "witnessId": WITNESS_ID,
                           "nonce": nonce, "revision": str(rev),
                           "policySha256": policy, "checkpointSha256": checkpoint,
                           "bootId": boot}
                sig = signer.sign(canonical(payload)).hex()
                self.send_json(200, {"payload": payload, "signature": sig})
            except (ValueError, UnicodeError, json.JSONDecodeError):
                self.send_json(400, {"status": "blocked"})
            except (OSError, sqlite3.Error):
                self.send_json(503, {"status": "blocked"})
        def send_json(self, code, obj):
            data = canonical(obj)
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def log_message(self, format, *args):
            return
    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("init", "advance", "serve", "serve-mtls", "head"))
    p.add_argument("--db", required=True)
    p.add_argument("--key")
    p.add_argument("--public")
    p.add_argument("--revision", type=int)
    p.add_argument("--policy")
    p.add_argument("--checkpoint")
    p.add_argument("--port", type=int, default=PORT)
    p.add_argument("--tls-cert")
    p.add_argument("--tls-key")
    p.add_argument("--tls-ca")
    p.add_argument("--client-identities")
    args = p.parse_args()
    try:
        if args.action == "init":
            if not args.key or not args.public:
                raise ValueError("init requires --key and --public")
            print(json.dumps({"publicKeyHex": initialize(args.db, args.key, args.public),
                              "status": "qualification-only"}))
        elif args.action == "advance":
            print(json.dumps({"revision": append_head(
                args.db, args.revision, args.policy, args.checkpoint),
                "status": "qualification-only"}))
        elif args.action == "head":
            print(json.dumps({"head": read_head(args.db), "status": "qualification-only"}))
        else:
            if not args.key:
                raise ValueError("service key missing")
            signer = load_signer(args.key)
            if args.action == "serve-mtls":
                # Qualification-only loopback listener; operator provisions
                # certificate chain, client identity map and CA out of band.
                required=(args.tls_cert,args.tls_key,args.tls_ca,args.client_identities)
                if not all(required):
                    raise ValueError("mTLS configuration incomplete")
                spec=importlib.util.spec_from_file_location(
                    "r2s_guard", Path(__file__).with_name("ge04-r2s-transport-guard.py"))
                guard=importlib.util.module_from_spec(spec)
                spec.loader.exec_module(guard)
                identities=guard.load_identities(args.client_identities)
                context=guard.tls_context(args.tls_cert,args.tls_key,args.tls_ca)
                def authorize(connection,method,path):
                    return guard.authorize_client(connection,identities,method,path)
                handler=handler_factory(args.db,signer,authorize=authorize)
            else:
                if any((args.tls_cert,args.tls_key,args.tls_ca,args.client_identities)):
                    raise ValueError("TLS config only valid in serve-mtls")
                handler=handler_factory(args.db,signer)
            with ThreadingHTTPServer((BIND, args.port),handler) as httpd:
                if args.action == "serve-mtls":
                    httpd.socket=context.wrap_socket(httpd.socket,server_side=True)
                httpd.serve_forever()
        return 0
    except (OSError, ValueError, TypeError, sqlite3.Error) as exc:
        print(json.dumps({"status": "blocked", "reason": type(exc).__name__}), file=sys.stderr)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
