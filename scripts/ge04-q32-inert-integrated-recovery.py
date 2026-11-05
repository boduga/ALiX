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


def reconcile(journal_db, target_db, attempt, key, digest):
    """Only observe persisted records. A missing receipt never authorizes retry."""
    row = journal_db.execute('SELECT phase FROM attempts WHERE id=?', (attempt,)).fetchone()
    if row is None:
        return 'HOLD_NO_ATTEMPT'
    phase = row[0]
    if phase != 'UNKNOWN_RECOVERY':
        return 'HOLD_NOT_AMBIGUOUS'
    observation = target.lookup(target_db, key, digest)
    if observation == 'CONFIRMED_SYNTHETIC':
        return 'RECONCILED_SYNTHETIC_ONLY'
    if observation == 'CONFLICT':
        return 'HOLD_INTEGRITY_CONFLICT'
    return 'HOLD_UNRESOLVED'


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
