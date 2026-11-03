#!/usr/bin/env python3
"""GE04 trusted ancestry negative tests; root-only positive in CI."""
import importlib.util
import os
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for candidate in ('relative/path', '/tmp/../etc', '/tmp//etc', '/tmp/./etc'):
    try:
        fd = module.open_trusted_directory(candidate, os.geteuid())
    except ValueError:
        pass
    else:
        os.close(fd)
        raise AssertionError('noncanonical path accepted: ' + candidate)

with tempfile.TemporaryDirectory(prefix='ge04-path-') as temp:
    root = Path(temp)
    child = root / 'child'
    child.mkdir(mode=0o700)
    link = root / 'link'
    link.symlink_to(child, target_is_directory=True)
    for candidate in (child, link):
        try:
            fd = module.open_trusted_directory(candidate, os.geteuid())
        except (OSError, PermissionError):
            pass  # /tmp is world-writable; symlink leaf must also fail.
        else:
            os.close(fd)
            raise AssertionError('untrusted /tmp ancestor accepted')
print('GE04 trusted ancestry negative PASS: noncanonical, world-writable ancestor and symlink paths denied')
