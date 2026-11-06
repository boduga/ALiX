#!/usr/bin/env python3
"""Inert transactional revocation-ordering experiment. No effects or authority.

The same disposable SQLite transaction serializes a synthetic final check and
revocation; no token, approval, signing key or mutation service is involved.
"""
import json
import sqlite3
from pathlib import Path

DENIED = 'DENIED GE04_SECURITY_HOLD'


class RevocationProbe:
    def __init__(self, path: Path):
        self.path = Path(path)

    def initialize(self):
        with sqlite3.connect(self.path, isolation_level=None) as db:
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, active INTEGER NOT NULL)')
            db.execute('INSERT INTO state VALUES (1, 1, 1)')
            db.execute('CREATE TABLE claims (nonce TEXT PRIMARY KEY, revision INTEGER NOT NULL)')

    def revoke(self):
        try:
            with sqlite3.connect(self.path, timeout=5, isolation_level=None) as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute('UPDATE state SET active=0, revision=revision+1 WHERE id=1')
                db.execute('COMMIT')
                return True
        except sqlite3.Error:
            return False

    def final_check(self, nonce: str, revision: int):
        """Returns a diagnostic observation ONLY, never an effect permit."""
        if not isinstance(nonce, str) or not nonce or len(nonce) > 256 or type(revision) is not int:
            return {'matched': False, 'reason': 'invalid', 'response': DENIED, 'authorized': False}
        try:
            with sqlite3.connect(self.path, timeout=5, isolation_level=None) as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT revision, active FROM state WHERE id=1').fetchone()
                if current is None or current != (revision, 1):
                    db.execute('ROLLBACK')
                    return {'matched': False, 'reason': 'revoked_or_stale', 'response': DENIED, 'authorized': False}
                row = db.execute('INSERT OR IGNORE INTO claims VALUES (?, ?)', (nonce, revision))
                db.execute('COMMIT')
                return {'matched': row.rowcount == 1,
                        'reason': 'diagnostic_claim_only' if row.rowcount else 'replay',
                        'response': DENIED, 'authorized': False}
        except sqlite3.Error:
            return {'matched': False, 'reason': 'store_unavailable', 'response': DENIED, 'authorized': False}


if __name__ == '__main__':
    print(json.dumps({'response': DENIED, 'authorized': False, 'disposition': 'HOLD'}))
    raise SystemExit(78)
