#!/usr/bin/env python3
"""Experimental protected monotonic release floor reader; no mutation."""
import importlib.util
import json
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_floor(floor_directory, release_sequence, owner_uid=0):
    """Read a protected independent floor; never accept caller-supplied floor value."""
    walk = load('trusted-path')
    reader = load('signed-installation')
    fd = walk.open_trusted_directory(floor_directory, owner_uid)
    try:
        record = json.loads(reader.read_protected_file(fd, 'floor.json', owner_uid, 4096))
        if (set(record) != {'version', 'minimumSequence'} or type(record['version']) is not int or
                record['version'] != 1 or type(record['minimumSequence']) is not int or
                not 0 <= record['minimumSequence'] <= 2**63 - 1):
            raise ValueError('invalid protected release floor')
        if type(release_sequence) is not int or not 0 <= release_sequence <= 2**63 - 1:
            raise ValueError('invalid candidate release sequence')
        if release_sequence < record['minimumSequence']:
            raise PermissionError('release below protected rollback floor')
        return record['minimumSequence']
    finally:
        import os
        os.close(fd)
