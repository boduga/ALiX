#!/usr/bin/env python3
"""Scratch-only atomic replay observation ledger; never grants authorization."""
import json
from pathlib import Path
import sqlite3

BASE = {'gate':'GE04_Q32_REPLAY_LEDGER', 'disposition':'HOLD',
        'authorized':False, 'qualified_independent_issuance':False,
        'real_effects_performed':0}


def initialize(path):
    with sqlite3.connect(path, timeout=5) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS observations (issuer TEXT NOT NULL, attempt TEXT NOT NULL, generation TEXT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY(issuer,attempt,generation,nonce))')


def observe(path, binding):
    """Atomically record synthetic occurrence; duplicate is denied, first is ALSO denied."""
    fields = ('issuer','attempt','generation','nonce')
    if not isinstance(binding, dict) or any(type(binding.get(k)) is not str or not binding[k].strip() for k in fields):
        return {**BASE, 'reason':'INVALID_BINDING'}
    try:
        with sqlite3.connect(path, timeout=5, isolation_level=None) as db:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            inserted = db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?,?)', tuple(binding[k] for k in fields)).rowcount
            db.execute('COMMIT')
        return {**BASE, 'reason':'FIRST_OBSERVATION_DENIED' if inserted else 'REPLAY_DENIED'}
    except sqlite3.Error:
        return {**BASE, 'reason':'LEDGER_ERROR_DENIED'}


def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument('--isolated-test',action='store_true')
    args=p.parse_args()
    print(json.dumps({**BASE, 'reason':'DENIED_SECURITY_HOLD' if args.isolated_test else 'ISOLATED_TEST_REQUIRED'}))
    return 78

if __name__=='__main__':raise SystemExit(main())
