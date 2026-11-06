#!/usr/bin/env python3
"""Disposable subprocess with explicit synthetic crash checkpoints; no effects."""
import argparse
import importlib.util
from pathlib import Path
import sys

P = Path(__file__).with_name('ge04-q32-inert-effect-journal.py')
spec = importlib.util.spec_from_file_location('ge04_inert_journal', P)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--isolated-test', action='store_true')
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--checkpoint', choices=('intent', 'possible'), required=True)
    args = parser.parse_args()
    if not args.isolated_test or not args.database.is_absolute():
        return 78
    with m.connect(args.database) as db:
        if not m.begin(db, 'synthetic-crash-attempt', 1):
            return 78
        if args.checkpoint == 'possible' and not m.mark_possible(db, 'synthetic-crash-attempt', 1):
            return 78
        # The parent may send SIGKILL only after this durable-commit checkpoint.
        print('CHECKPOINT:' + args.checkpoint, flush=True)
        # Block without external effects until parent kills this disposable child.
        import signal
        signal.pause()
    return 78

if __name__ == '__main__':
    raise SystemExit(main())
