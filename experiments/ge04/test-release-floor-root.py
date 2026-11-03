#!/usr/bin/env python3
"""Root-gated protected rollback floor fixture; not a signed-sequence gate."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 release floor REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_floor', Path(__file__).with_name('release-floor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-floor-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    floor = root / 'floor'
    floor.mkdir(mode=0o700)
    record = floor / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 12}))
    record.chmod(0o400)
    assert module.verify_floor(floor, 12, 0) == 12
    assert module.verify_floor(floor, 13, 0) == 12
    try:
        module.verify_floor(floor, 11, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('below-floor sequence accepted')
    record.chmod(0o600)
    try:
        module.verify_floor(floor, 13, 0)
    except PermissionError:
        pass
    else:
        raise AssertionError('writable floor accepted')
    record.chmod(0o400)
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
            try:
                record.write_text('forged')
            except PermissionError:
                os._exit(0)
            os._exit(1)
        except BaseException:
            os._exit(2)
    _, status = os.waitpid(pid, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
print('GE04 protected floor root PASS: below-floor denied; writable floor denied; distinct UID cannot overwrite')
