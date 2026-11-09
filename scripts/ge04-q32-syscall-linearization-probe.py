#!/usr/bin/env python3
"""GE-04 disposable syscall-adjacent serialization experiment. HOLD, NOT AUTHORITY.

A single synthetic supervisor owns both the revocation transition and the
actual os.write syscall, under the SAME lock. This is an ordering experiment,
not a credential issuer, durable journal, crash-safe protocol, or ALiX backend.
Only writes to a file descriptor created inside a private TemporaryDirectory.
No externally supplied path, descriptor, callback, policy, or token is accepted.
"""
import json
import os
import tempfile
import threading
from pathlib import Path


class ScratchSupervisor:
    def __init__(self):
        self._lock = threading.Lock()
        self._active = True
        self._used = set()
        self._scratch = tempfile.TemporaryDirectory(prefix="ge04-effect-probe-")
        self._target = Path(self._scratch.name) / "effect.bin"
        self._fd = os.open(self._target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        self._closed = False
        self._effects = 0

    def effect(self, nonce, *, entered=None, release=None):
        """Synthetic single-use effect, protected across the actual syscall.

        Test hooks execute INSIDE the lock, to force deterministic races.
        They are not exposed over a process/IPC boundary.
        """
        with self._lock:
            if self._closed or not self._active or not isinstance(nonce, str) or not nonce or nonce in self._used:
                return False
            if entered is not None:
                entered.set()
            if release is not None:
                if not release.wait(timeout=5):
                    return False
            # Lock still held: revoke cannot linearize before this syscall.
            # A partial write/error is UNKNOWN, not safely retryable.
            self._used.add(nonce)
            try:
                count = os.write(self._fd, b"X")
            except OSError:
                return False
            if count != 1:
                return False
            self._effects += 1
            return True

    def revoke(self, *, entered=None):
        if entered is not None:
            entered.set()
        with self._lock:
            self._active = False
            return True

    def snapshot(self):
        with self._lock:
            return {"active": self._active, "effects": self._effects,
                    "bytes": self._target.read_bytes()}

    def close(self):
        with self._lock:
            if not self._closed:
                self._closed = True
                os.close(self._fd)
        self._scratch.cleanup()


def main():
    print(json.dumps({"gate": "GE04_Q32_SYSCALL_LINEARIZATION_PROBE",
                      "disposition": "HOLD", "qualified_effect_authority": False,
                      "production_effects_performed": 0}))
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
