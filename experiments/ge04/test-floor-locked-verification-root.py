#!/usr/bin/env python3
"""Root-gated proof that candidate derivation runs inside the update flock."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 locked verification REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_advance', Path(__file__).with_name('floor-advance.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-locked-verify-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    directory = root / 'floor'
    directory.mkdir(mode=0o700)
    record = directory / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 3}))
    record.chmod(0o400)
    parent_lock = os.open(directory / '.floor-update.lock', os.O_CREAT | os.O_RDWR, 0o600)
    fcntl.flock(parent_lock, fcntl.LOCK_EX)
    signal.alarm(15)
    pid = os.fork()
    if pid == 0:
        os.close(parent_lock)
        try:
            def candidate():
                (directory / 'verified.marker').write_text('inside-lock')
                return 4
            module.advance(directory, None, candidate_provider=candidate)
        except BaseException:
            os._exit(1)
        os._exit(0)
    try:
        import time
        time.sleep(0.2)
        assert not (directory / 'verified.marker').exists(), 'verification ran before lock acquisition'
        assert os.waitpid(pid, os.WNOHANG) == (0, 0), 'child did not wait for lock'
        fcntl.flock(parent_lock, fcntl.LOCK_UN)
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
        assert (directory / 'verified.marker').read_text() == 'inside-lock'
        assert json.loads(record.read_text())['minimumSequence'] == 4
    finally:
        os.close(parent_lock)
        signal.alarm(0)
print('GE04 locked verification root PASS: candidate derived under cooperative update lock')
