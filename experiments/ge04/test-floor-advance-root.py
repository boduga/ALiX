#!/usr/bin/env python3
"""Root-gated cooperative floor advancement fixture; no authorization."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 floor advancement REQUIRES root (not a pass)')
def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
advance = load('floor-advance').advance
floor = load('release-floor').verify_floor
with tempfile.TemporaryDirectory(prefix='ge04-floor-advance-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    directory = root / 'floor'
    directory.mkdir(mode=0o700)
    record = directory / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 4}))
    record.chmod(0o400)
    assert advance(directory, 5) == 5
    assert floor(directory, 5) == 5
    assert advance(directory, 5) == 5
    try:
        advance(directory, 4)
    except PermissionError:
        pass
    else:
        raise AssertionError('floor downgrade accepted')
    try:
        floor(directory, 4)
    except PermissionError:
        pass
    else:
        raise AssertionError('old signed sequence accepted')
    pid = os.fork()
    if pid == 0:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
        try:
            advance(directory, 999)
        except (PermissionError, OSError):
            os._exit(0)
        os._exit(1)
    _, status = os.waitpid(pid, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
    assert floor(directory, 5) == 5
print('GE04 floor advancement root PASS: fsynced update; downgrade denied; distinct UID denied')
