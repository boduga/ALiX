#!/usr/bin/env python3
"""Test-only separate authority registry; no keys, signatures or effect authority."""
import sqlite3

SCHEMA = '''CREATE TABLE IF NOT EXISTS authority_bindings (
 attempt TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL, revision INTEGER NOT NULL,
 audience TEXT NOT NULL, generation INTEGER NOT NULL)'''

def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=2)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute(SCHEMA)
    return db

def issue(db, attempt, key, digest, revision, audience, generation):
    """Test fixture only; caller MUST enforce custody outside this module."""
    if not all((attempt,key,digest,audience)) or revision < 1 or generation < 1:
        return False
    db.execute('BEGIN IMMEDIATE')
    try:
        inserted = db.execute('INSERT OR IGNORE INTO authority_bindings VALUES (?,?,?,?,?,?)',
                              (attempt,key,digest,revision,audience,generation)).rowcount == 1
        db.execute('COMMIT')
        return inserted
    except BaseException:
        db.execute('ROLLBACK')
        raise

def verify(db, attempt, key, digest, revision, audience, generation):
    """Read-only comparison to an independently supplied authority DB handle."""
    row = db.execute('SELECT idempotency_key,request_digest,revision,audience,generation FROM authority_bindings WHERE attempt=?', (attempt,)).fetchone()
    if row is None:
        return 'HOLD_NO_AUTHORITY_BINDING'
    if row != (key,digest,revision,audience,generation):
        return 'HOLD_AUTHORITY_MISMATCH'
    return 'MATCH_SYNTHETIC_ONLY'
