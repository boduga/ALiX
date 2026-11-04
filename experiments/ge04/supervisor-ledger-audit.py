#!/usr/bin/env python3
"""Read-only inventory of protected pre-spawn evidence; never grants authority.

A single unknown or corrupt entry quarantines the entire inventory.
"""
import importlib.util
import os
from pathlib import Path
import stat


def audit(evidence_root: Path, owner_uid: int = 0) -> tuple[str, tuple[str, ...]]:
    spec = importlib.util.spec_from_file_location('ge04_ledger_reconcile', Path(__file__).with_name('supervisor-ledger-reconcile.py'))
    recovery = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recovery)
    spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
    trusted = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trusted)
    spec = importlib.util.spec_from_file_location('ge04_denial_reconcile', Path(__file__).with_name('supervisor-denial-reconcile.py'))
    denial = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(denial)
    try:
        fd = trusted.open_trusted_directory(evidence_root, owner_uid)
        try:
            names = sorted(os.listdir(fd))
            if len(names) > 10000:
                return 'UNCERTAIN', ()
            attempts = set()
            denials = set()
            for name in names:
                if name.endswith('.json'):
                    attempt, group = name[:-5], attempts
                elif name.endswith('.denied'):
                    attempt, group = name[:-7], denials
                else:
                    return 'UNCERTAIN', ()
                if not recovery.ATTEMPT.fullmatch(attempt):
                    return 'UNCERTAIN', ()
                metadata = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid or
                        metadata.st_nlink != 1 or metadata.st_mode & 0o077):
                    return 'UNCERTAIN', ()
                group.add(attempt)
            if not denials.issubset(attempts):
                return 'UNCERTAIN', ()
            for attempt in sorted(attempts):
                if recovery.classify(evidence_root, attempt, owner_uid) != 'NOT_AUTHORIZED':
                    return 'UNCERTAIN', ()
                if attempt in denials and denial.reconcile(evidence_root, attempt, owner_uid) != 'DENIED':
                    return 'UNCERTAIN', ()
            return ('DENY_ONLY' if denials else 'NOT_AUTHORIZED_ONLY'), tuple(sorted(attempts))
        finally:
            os.close(fd)
    except (OSError, ValueError, TypeError, PermissionError):
        return 'UNCERTAIN', ()
