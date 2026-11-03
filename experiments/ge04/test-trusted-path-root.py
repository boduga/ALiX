#!/usr/bin/env python3
"""Root-only positive and adversarial trusted-ancestry test, no elevation."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 trusted path root gate REQUIRES root (not a pass)')

spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# /run is normally root-owned and not group/other-writable on Ubuntu CI.
with tempfile.TemporaryDirectory(prefix='ge04-path-', dir='/run') as temp:
    root = Path(temp)
    root.chmod(0o700)
    child = root / 'trusted'
    child.mkdir(mode=0o700)
    fd = module.open_trusted_directory(child, 0)
    try:
        assert os.fstat(fd).st_uid == 0
    finally:
        os.close(fd)
    child.chmod(0o777)
    try:
        fd = module.open_trusted_directory(child, 0)
    except PermissionError:
        pass
    else:
        os.close(fd)
        raise AssertionError('writable child accepted')
    child.chmod(0o700)
    link = root / 'link'
    link.symlink_to(child, target_is_directory=True)
    try:
        fd = module.open_trusted_directory(link, 0)
    except OSError:
        pass
    else:
        os.close(fd)
        raise AssertionError('symlink component accepted')
print('GE04 trusted ancestry root PASS: root-owned chain accepted; writable and symlink components denied')
