#!/usr/bin/env python3
"""Disposable SQLite revocation/effect-start serialization experiment. NO effects.

CRITICAL: committing EFFECT_POSSIBLE is NOT a final-effect fence. Revocation
can commit after this transition but before any real syscall. No caller may
use a successful synthetic transition to perform an effect. A real supervisor
must own the effect and serialize its boundary against revocation.
"""
import json
import sqlite3

SCHEMA = """
CREATE TABLE authority (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, active INTEGER NOT NULL);
INSERT INTO authority VALUES (1,1,1);
CREATE TABLE attempts (
 nonce TEXT PRIMARY KEY,
 revision INTEGER NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('CLAIMED','EFFECT_POSSIBLE','UNKNOWN_RECOVERY'))
);
"""

def initialize(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=5)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA journal_mode=DELETE')
    db.executescript(SCHEMA)
    return db

def transact(db, action, nonce=None, revision=1):
    """Serialize scratch transitions only; return observations, never permits.

    The transaction ends BEFORE any hypothetical effect, leaving a revocation
    gap. The True return value is diagnostic and must never be treated as an
    authorization decision.
    """
    try:
        db.execute('BEGIN IMMEDIATE')
        current = db.execute('SELECT revision,active FROM authority WHERE id=1').fetchone()
        if current is None:
            db.execute('ROLLBACK')
            return False
        if action == 'revoke':
            db.execute('UPDATE authority SET active=0, revision=revision+1 WHERE id=1')
            db.execute('COMMIT')
            return True
        if type(nonce) is not str or not nonce or len(nonce)>256 or type(revision) is not int or revision<1:
            db.execute('ROLLBACK')
            return False
        if current != (revision,1):
            db.execute('ROLLBACK')
            return False
        if action == 'claim':
            changed = db.execute("INSERT OR IGNORE INTO attempts VALUES (?,?,'CLAIMED')",(nonce,revision)).rowcount
        elif action == 'effect_start':
            changed = db.execute("UPDATE attempts SET phase='EFFECT_POSSIBLE' WHERE nonce=? AND revision=? AND phase='CLAIMED'",(nonce,revision)).rowcount
        else:
            db.execute('ROLLBACK')
            return False
        db.execute('COMMIT')
        return changed == 1
    except sqlite3.Error:
        if db.in_transaction: db.execute('ROLLBACK')
        return False

def recover(db):
    """Ambiguous effect-starts remain permanently non-retryable."""
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE attempts SET phase='UNKNOWN_RECOVERY' WHERE phase='EFFECT_POSSIBLE'")
        db.execute('COMMIT')
        return True
    except sqlite3.Error:
        if db.in_transaction: db.execute('ROLLBACK')
        return False

if __name__ == '__main__':
    print(json.dumps({'gate':'GE04_Q32_INERT_EFFECT_START','disposition':'HOLD',
                      'qualified_effect_authority':False,'real_effects_performed':0}))
    raise SystemExit(78)
