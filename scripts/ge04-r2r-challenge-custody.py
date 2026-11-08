"""GE-04-R2R verifier-owned durable challenge custody (qualification only).

A one-time nonce is durably issued before sending a witness request and is
atomically consumed before interpreting any response. Crash during consumption
is fail-closed. This does not establish independent witness key provenance,
rollback-resistant verifier storage, or authority to admit workers.
"""
from __future__ import annotations
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time

_NONCE = re.compile(r"[a-f0-9]{64}")


def _check_file(path):
    p = Path(path)
    if not p.is_absolute() or p.is_symlink():
        raise ValueError("challenge database path must be absolute and non-symlink")
    parent = p.parent
    st = os.lstat(parent)
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid()
            or stat.S_IMODE(st.st_mode) != 0o700):
        raise PermissionError("challenge database parent not exclusively owned")
    st = os.lstat(path)
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid()
            or stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1):
        raise PermissionError("unsafe challenge database")
    return str(p)


class ChallengeCustody:
    def __init__(self, path, *, boot_id=None):
        self.path = _check_file(path)
        self.boot_id = boot_id or Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        if not self.boot_id or type(self.boot_id) is not str:
            raise ValueError("invalid boot identity")
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        try:
            self.db.execute("PRAGMA journal_mode=DELETE")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("""CREATE TABLE IF NOT EXISTS challenges (
                nonce TEXT PRIMARY KEY,
                boot_id TEXT NOT NULL,
                created_mono REAL NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('issued','consumed'))
            )""")
        except Exception:
            self.db.close()
            raise

    def close(self):
        self.db.close()

    def issue(self):
        """Durably issue a random challenge; no API accepts a caller-selected nonce."""
        nonce = secrets.token_hex(32)
        created = time.monotonic()
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute(
                "INSERT INTO challenges VALUES (?,?,?,'issued')",
                (nonce, self.boot_id, created))
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return nonce

    def consume(self, nonce, *, ttl_seconds=60):
        """Single-use even on failed signature or exception after consumption."""
        if type(nonce) is not str or not _NONCE.fullmatch(nonce):
            return False
        if type(ttl_seconds) not in (int, float) or not 0 < ttl_seconds <= 300:
            raise ValueError("invalid lifetime")
        current_boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        now = time.monotonic()
        self.db.execute("BEGIN IMMEDIATE")
        try:
            cursor = self.db.execute(
                """UPDATE challenges SET state='consumed'
                WHERE nonce=? AND boot_id=? AND state='issued'
                AND created_mono<=? AND created_mono>=?""",
                (nonce, self.boot_id, now, now - ttl_seconds)
            ) if current_boot == self.boot_id else None
            consumed = cursor is not None and cursor.rowcount == 1
            self.db.execute("COMMIT")
            return consumed
        except Exception:
            self.db.execute("ROLLBACK")
            raise


def create_custody(path):
    """Only explicit qualification setup creates a database; exclusive file mode."""
    p = Path(path)
    if not p.is_absolute():
        raise ValueError("absolute database path required")
    parent = p.parent
    st = os.lstat(parent)
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid()
            or stat.S_IMODE(st.st_mode) != 0o700):
        raise PermissionError("untrusted challenge database directory")
    fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    return str(p)
