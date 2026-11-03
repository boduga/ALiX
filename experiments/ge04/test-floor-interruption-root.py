#!/usr/bin/env python3
"""Root-gated process-crash injection at floor publication boundaries."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 floor interruption REQUIRES root (not a pass)')
spec = importlib.util.spec_from_file_location('ge04_advance', Path(__file__).with_name('floor-advance.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='ge04-floor-interrupt-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    directory = root / 'floor'
    directory.mkdir(mode=0o700)
    record = directory / 'floor.json'
    record.write_text(json.dumps({'version': 1, 'minimumSequence': 4}))
    record.chmod(0o400)

    def committed():
        return json.loads(record.read_text())['minimumSequence']

    def crash_at(stage, sequence):
        pid = os.fork()
        if pid == 0:
            if stage == 'before_rename':
                def interrupt_rename(*args, **kwargs):
                    os._exit(91)
                module.os.rename = interrupt_rename
            else:
                real_fsync = os.fsync
                def interrupt_directory_fsync(fd):
                    if stat.S_ISDIR(os.fstat(fd).st_mode):
                        os._exit(92)
                    return real_fsync(fd)
                module.os.fsync = interrupt_directory_fsync
            module.advance(directory, sequence)
            os._exit(93)
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == (91 if stage == 'before_rename' else 92), 'fault injection missed'

    crash_at('before_rename', 5)
    assert committed() == 4, 'pre-publication crash changed committed floor'
    assert list(directory.glob('.floor-stage-*')), 'expected orphan stage after crash'
    assert module.advance(directory, 5) == 5, 'lock not released after process exit'
    assert committed() == 5
    crash_at('after_rename', 6)
    assert committed() == 6, 'post-rename process exit not visible to subsequent process'
    assert module.advance(directory, 6) == 6
    try:
        module.advance(directory, 5)
    except PermissionError:
        pass
    else:
        raise AssertionError('post-interruption rollback accepted')
print('GE04 floor interruption root PASS: pre-rename orphan, post-rename visibility, lock recovery')
