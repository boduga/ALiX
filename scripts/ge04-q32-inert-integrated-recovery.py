#!/usr/bin/env python3
"""Read-only synthetic journal/target reconciliation; no submit, retry or effects."""
import importlib.util
import json
from pathlib import Path
import sys


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

journal = load('ge04_inert_journal_integrated', 'ge04-q32-inert-effect-journal.py')
target = load('ge04_inert_target_integrated', 'ge04-q32-inert-target-reconcile.py')
custody = load('ge04_inert_custody_integrated', 'ge04-q32-inert-custody.py')


# Test-only immutable binding in the SAME unprotected scratch journal.
# This is not independent issuer custody or an authenticated artifact.
BINDING_SCHEMA = """CREATE TABLE IF NOT EXISTS synthetic_bindings (
 attempt TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL, revision INTEGER NOT NULL,
 FOREIGN KEY(attempt) REFERENCES attempts(id))"""


def bind_synthetic(journal_db, attempt, key, digest, revision):
    """Create one immutable scratch binding before recovery, never overwrite."""
    if not attempt or not key or not digest or revision < 1:
        return False
    journal_db.execute(BINDING_SCHEMA)
    journal_db.execute('BEGIN IMMEDIATE')
    try:
        row = journal_db.execute('SELECT revision, phase FROM attempts WHERE id=?', (attempt,)).fetchone()
        if row is None or row != (revision, 'INTENT'):
            journal_db.execute('ROLLBACK')
            return False
        cursor = journal_db.execute(
            'INSERT OR IGNORE INTO synthetic_bindings VALUES (?,?,?,?)',
            (attempt, key, digest, revision))
        journal_db.execute('COMMIT')
        return cursor.rowcount == 1
    except BaseException:
        journal_db.execute('ROLLBACK')
        raise


def reconcile(journal_db, target_db, attempt, key, digest, revision=1):
    """Read-only binding check, then read-only target lookup; never retry."""
    row = journal_db.execute('SELECT phase, revision FROM attempts WHERE id=?', (attempt,)).fetchone()
    if row is None:
        return 'HOLD_NO_ATTEMPT'
    phase, stored_revision = row
    if phase != 'UNKNOWN_RECOVERY':
        return 'HOLD_NOT_AMBIGUOUS'
    binding_exists = journal_db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='synthetic_bindings'").fetchone()
    if not binding_exists:
        return 'HOLD_MISSING_BINDING'
    binding = journal_db.execute(
        'SELECT idempotency_key, request_digest, revision FROM synthetic_bindings WHERE attempt=?',
        (attempt,)).fetchone()
    if binding is None:
        return 'HOLD_MISSING_BINDING'
    if binding != (key, digest, revision) or stored_revision != revision:
        return 'HOLD_BINDING_MISMATCH'
    observation = target.lookup(target_db, key, digest)
    if observation == 'CONFIRMED_SYNTHETIC':
        return 'RECONCILED_SYNTHETIC_ONLY'
    if observation == 'CONFLICT':
        return 'HOLD_INTEGRITY_CONFLICT'
    return 'HOLD_UNRESOLVED'


def reconcile_with_authority(journal_db, target_db, authority_db, attempt, key, digest,
                             revision=1, audience='supervisor', generation=1):
    """Independent-handle synthetic check before untrusted journal reconciliation."""
    verdict = custody.verify(authority_db, attempt, key, digest, revision, audience, generation)
    if verdict != 'MATCH_SYNTHETIC_ONLY':
        return verdict
    return reconcile(journal_db, target_db, attempt, key, digest, revision)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    parser.add_argument('--journal', type=Path)
    parser.add_argument('--target', type=Path)
    args = parser.parse_args()
    if (not args.isolated_test or args.journal is None or args.target is None
            or not args.journal.is_absolute() or not args.target.is_absolute()
            or args.journal == args.target):
        print(json.dumps({'gate':'GE04_Q32_INERT_INTEGRATED_RECOVERY','disposition':'HOLD','reason':'separate absolute scratch paths required'}))
        return 78
    try:
        with journal.connect(args.journal) as j, target.connect(args.target) as t:
            journal.begin(j, 'synthetic-attempt', 1)
            bind_synthetic(j, 'synthetic-attempt', 'synthetic-key', 'synthetic-digest', 1)
            journal.mark_possible(j, 'synthetic-attempt', 1)
            journal.recover(j, 'synthetic-attempt')
            outcome = reconcile(j, t, 'synthetic-attempt', 'synthetic-key', 'synthetic-digest')
        print(json.dumps({'gate':'GE04_Q32_INERT_INTEGRATED_RECOVERY','disposition':'HOLD',
                          'outcome':outcome,'real_effects_performed':0,'automatic_retries':0,
                          'qualified_effect_authority':False}))
    except Exception as exc:
        print(json.dumps({'gate':'GE04_Q32_INERT_INTEGRATED_RECOVERY','disposition':'HOLD','error':type(exc).__name__}))
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
