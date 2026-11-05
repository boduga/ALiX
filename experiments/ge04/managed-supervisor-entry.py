#!/usr/bin/env python3
"""GE-04 experimental systemd startup gate. No production mutation path.

This is a privileged test/commissioning entrypoint. It checks installation
and fixed bootstrap config before delegating to the inert subprocess.
"""
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

def _load():
    spec = importlib.util.spec_from_file_location(
        'ge04_managed_install', Path(__file__).with_name('protected-supervisor-installation.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def _trusted_config(path):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('root-only bootstrap verifier')
    raw_path = Path(path)
    if not raw_path.is_absolute() or '..' in raw_path.parts:
        raise ValueError('absolute config path required')
    directory = raw_path.parent
    dirfd = os.open(directory, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        meta = os.fstat(dirfd)
        if (not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or
                meta.st_mode & 0o077):
            raise PermissionError('unsafe bootstrap directory')
        fd = os.open(raw_path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dirfd)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or
                    before.st_nlink != 1 or before.st_mode & 0o077 or
                    not 0 < before.st_size <= 2048):
                raise PermissionError('unsafe bootstrap configuration')
            payload = os.read(fd, 2049)
            after = os.fstat(fd)
            if (len(payload) != before.st_size or
                    (before.st_dev, before.st_ino, before.st_size,
                     before.st_mtime_ns, before.st_ctime_ns) !=
                    (after.st_dev, after.st_ino, after.st_size,
                     after.st_mtime_ns, after.st_ctime_ns)):
                raise PermissionError('bootstrap configuration changed during read')
        finally:
            os.close(fd)
    finally:
        os.close(dirfd)
    def unique(pairs):
        out = {}
        for k, v in pairs:
            if k in out:
                raise PermissionError('duplicate bootstrap configuration field')
            out[k] = v
        return out
    obj = json.loads(payload, object_pairs_hook=unique)
    if (type(obj) is not dict or
            set(obj) != {'version', 'installation', 'private', 'public', 'coordinatorPid', 'coordinatorUid'} or
            type(obj['version']) is not int or obj['version'] != 1 or
            type(obj['coordinatorPid']) is not int or obj['coordinatorPid'] <= 0 or
            type(obj['coordinatorUid']) is not int or obj['coordinatorUid'] <= 0):
        raise PermissionError('invalid bootstrap configuration')
    for key in ('installation', 'private', 'public'):
        value = obj[key]
        if (type(value) is not str or not value.startswith('/') or
                not Path(value).is_absolute() or '..' in Path(value).parts):
            raise PermissionError('unsafe bootstrap path')
    if len({obj[key] for key in ('installation', 'private', 'public')}) != 3:
        raise PermissionError('bootstrap paths overlap')
    return obj

def verify_startup(config_path):
    config = _trusted_config(config_path)
    install = _load()
    if install.verify(config['installation']) != 'GE04_INSTALLATION_VERIFIED_UNTRUSTED':
        raise PermissionError('invalid supervisor installation')
    return config

def run(config_path):
    config = verify_startup(config_path)
    child = _load().launch(
        config['installation'], config['private'], config['public'],
        config['coordinatorPid'], config['coordinatorUid'])
    try:
        for line in child.stdout:
            # Test-only observation; no key, file paths or authority state.
            print(line.rstrip(), flush=True)
        return child.wait(timeout=12)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: managed-supervisor-entry.py /etc/alix-ge04-inert/bootstrap.json')
    raise SystemExit(run(sys.argv[1]))
