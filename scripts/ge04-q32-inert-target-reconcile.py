#!/usr/bin/env python3
"""Isolated SQLite target simulator. Never executes real effects or authorizes anything."""
import argparse
import json
from pathlib import Path
import sqlite3

SCHEMA = '''CREATE TABLE IF NOT EXISTS target_receipts (
 idempotency_key TEXT PRIMARY KEY,
 request_digest TEXT NOT NULL,
 synthetic_result TEXT NOT NULL
)'''

def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=2)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute(SCHEMA)
    return db

def submit(db, key, digest):
    """Simulate target commit and optional acknowledgement loss, never a real effect."""
    if not key or not digest:
        return 'DENIED', None
    db.execute('BEGIN IMMEDIATE')
    try:
        row = db.execute('SELECT request_digest, synthetic_result FROM target_receipts WHERE idempotency_key=?', (key,)).fetchone()
        if row:
            db.execute('COMMIT')
            return ('REPLAY_SAME', row[1]) if row[0] == digest else ('CONFLICT', None)
        result = 'SYNTHETIC_APPLIED'
        db.execute('INSERT INTO target_receipts VALUES (?, ?, ?)', (key, digest, result))
        db.execute('COMMIT')
        return 'FIRST_COMMIT', result
    except BaseException:
        db.execute('ROLLBACK')
        raise

def lookup(db, key, digest):
    """Read-only reconciliation: no retry, no insertion, no effect."""
    row = db.execute('SELECT request_digest, synthetic_result FROM target_receipts WHERE idempotency_key=?', (key,)).fetchone()
    if row is None:
        return 'NOT_OBSERVED'
    return 'CONFIRMED_SYNTHETIC' if row[0] == digest else 'CONFLICT'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    parser.add_argument('--database', type=Path)
    args = parser.parse_args()
    if not args.isolated_test or args.database is None or not args.database.is_absolute():
        print(json.dumps({'gate':'GE04_Q32_INERT_TARGET','disposition':'HOLD','reason':'isolated absolute scratch path required'}))
        return 78
    try:
        with connect(args.database) as db:
            submit(db, 'synthetic-key', 'synthetic-digest')
            observed = lookup(db, 'synthetic-key', 'synthetic-digest')
        print(json.dumps({'gate':'GE04_Q32_INERT_TARGET','disposition':'HOLD','synthetic_lookup':observed,
                          'real_effects_performed':0,'qualified_effect_authority':False}))
    except sqlite3.Error as exc:
        print(json.dumps({'gate':'GE04_Q32_INERT_TARGET','disposition':'HOLD','error':type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
