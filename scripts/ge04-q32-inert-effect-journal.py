#!/usr/bin/env python3
"""Synthetic SQLite effect-intent crash journal. NO external effects or authority."""
import argparse
import json
import sqlite3
from pathlib import Path

SCHEMA = '''CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, phase TEXT NOT NULL CHECK(phase IN
 ('INTENT','EFFECT_POSSIBLE','CONFIRMED','UNKNOWN_RECOVERY','ABORTED')),
 revision INTEGER NOT NULL, receipt TEXT,
 CHECK ((phase = 'CONFIRMED' AND receipt IS NOT NULL) OR
        (phase != 'CONFIRMED' AND receipt IS NULL))
)'''


def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=2)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute(SCHEMA)
    return db


def begin(db, attempt, revision):
    """Persist synthetic intent, once; never reissue a reused attempt."""
    with db:
        db.execute('BEGIN IMMEDIATE')
        cursor = db.execute('INSERT OR IGNORE INTO attempts VALUES (?, ?, ?, NULL)',
                            (attempt, 'INTENT', revision))
        return cursor.rowcount == 1


def mark_possible(db, attempt, revision):
    """Synthetic pre-effect boundary; NO effect is invoked."""
    with db:
        db.execute('BEGIN IMMEDIATE')
        return db.execute("UPDATE attempts SET phase='EFFECT_POSSIBLE' WHERE id=? AND revision=? AND phase='INTENT'", (attempt, revision)).rowcount == 1


def recover(db, attempt):
    """Fail closed: after possible effect, outcome is permanently ambiguous."""
    with db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE attempts SET phase='UNKNOWN_RECOVERY' WHERE id=? AND phase='EFFECT_POSSIBLE'", (attempt,))
        db.execute("UPDATE attempts SET phase='ABORTED' WHERE id=? AND phase='INTENT'", (attempt,))
        row = db.execute('SELECT phase FROM attempts WHERE id=?', (attempt,)).fetchone()
        return row[0] if row else None


def phase(db, attempt):
    row = db.execute('SELECT phase FROM attempts WHERE id=?', (attempt,)).fetchone()
    return row[0] if row else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--isolated-test', action='store_true')
    p.add_argument('--database', type=Path)
    args = p.parse_args()
    if not args.isolated_test or args.database is None or not args.database.is_absolute():
        print(json.dumps({'gate':'GE04_Q32_INERT_JOURNAL','disposition':'HOLD','reason':'isolated absolute scratch path required'}))
        return 78
    try:
        with connect(args.database) as db:
            begin(db, 'synthetic-attempt', 1)
            mark_possible(db, 'synthetic-attempt', 1)
            recovered = recover(db, 'synthetic-attempt')
        print(json.dumps({'gate':'GE04_Q32_INERT_JOURNAL','disposition':'HOLD',
                          'recovery':recovered,'real_effects_performed':0,
                          'qualified_effect_authority':False}))
    except sqlite3.Error as exc:
        print(json.dumps({'gate':'GE04_Q32_INERT_JOURNAL','disposition':'HOLD','error':type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
