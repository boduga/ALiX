#!/usr/bin/env python3
"""Disposable SQLite single-use claim experiment. No authorization or effects.

This is NOT protected custody: whoever can write the database can mint claims.
No production component may import this as an authorization gate.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path


def binding_digest(binding: dict) -> str:
    return hashlib.sha256(json.dumps(binding, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True).encode('ascii')).hexdigest()


class ClaimProbe:
    """Test-only atomicity probe; a successful claim NEVER authorizes effects."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def initialize(self):
        with sqlite3.connect(self.path, timeout=5, isolation_level=None) as db:
            db.execute('PRAGMA busy_timeout=5000')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('CREATE TABLE IF NOT EXISTS claims (nonce TEXT PRIMARY KEY, digest TEXT NOT NULL)')

    def claim(self, nonce: str, binding: dict) -> bool:
        """Only tests the unique insert, never an authorization decision."""
        if not isinstance(nonce, str) or not nonce or len(nonce) > 256:
            return False
        if not isinstance(binding, dict):
            return False
        try:
            digest = binding_digest(binding)
            with sqlite3.connect(self.path, timeout=5, isolation_level=None) as db:
                db.execute('PRAGMA busy_timeout=5000')
                db.execute('PRAGMA synchronous=FULL')
                db.execute('BEGIN IMMEDIATE')
                try:
                    cursor = db.execute('INSERT OR IGNORE INTO claims(nonce, digest) VALUES (?, ?)',
                                        (nonce, digest))
                    db.execute('COMMIT')
                    return cursor.rowcount == 1
                except BaseException:
                    db.execute('ROLLBACK')
                    raise
        except (sqlite3.Error, OSError, ValueError, TypeError):
            return False


if __name__ == '__main__':
    print('DENIED GE04_SECURITY_HOLD')
    raise SystemExit(78)
