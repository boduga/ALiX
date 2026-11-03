#!/usr/bin/env python3
"""Cooperative cross-process floor concurrency and orphan staging fixture."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 floor concurrency REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_advance', Path(__file__).with_name('floor-advance.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-floor-race-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    directory = root / 'floor'
    directory.mkdir(mode=0o700)
    record = directory / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 2}))
    record.chmod(0o400)
    orphan = directory / '.floor-stage-interrupted'
    orphan.write_text(json.dumps({'version': 1, 'minimumSequence': 999}))
    orphan.chmod(0o400)
    children = []
    for sequence in (3, 5, 4, 8, 6, 7):
        pid = os.fork()
        if pid == 0:
            try:
                module.advance(directory, sequence)
            except PermissionError:
                os._exit(0)  # An already higher committed floor must reject this attempt.
            except BaseException:
                os._exit(1)
            os._exit(0)
        children.append(pid)
    for pid in children:
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, 'concurrent updater failed'
    assert json.loads(record.read_text())['minimumSequence'] == 8
    assert orphan.exists(), 'orphan staging fixture unexpectedly used'
    try:
        module.advance(directory, 7)
    except PermissionError:
        pass
    else:
        raise AssertionError('concurrent downgrade accepted')
print('GE04 floor concurrency root PASS: cooperative monotonic updates and orphan staging ignored')
