#!/usr/bin/env python3
"""Read-only, fail-closed classification of protected release/floor state.

Experimental diagnostics only: never authorizes execution or repairs state.
"""
import importlib.util
import json
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def classify(config_path, release_path, floor_path, owner_uid=0):
    """Return verified-current or quarantine; never replay or lower the floor."""
    verifier = load('trusted-release-verification')
    try:
        _digest, signed_sequence = verifier.verify(config_path, release_path, owner_uid, floor_path, True)
    except Exception:
        return 'UNCERTAIN'
    try:
        walk = load('trusted-path')
        reader = load('signed-installation')
        import os
        fd = walk.open_trusted_directory(floor_path, owner_uid)
        try:
            record = json.loads(reader.read_protected_file(fd, 'floor.json', owner_uid, 4096))
        finally:
            os.close(fd)
        if set(record) != {'version', 'minimumSequence'} or type(record['version']) is not int or record['version'] != 1 or type(record['minimumSequence']) is not int:
            return 'UNCERTAIN'
        if signed_sequence != record['minimumSequence']:
            return 'UNCERTAIN'
    except Exception:
        return 'UNCERTAIN'
    return 'VERIFIED_CURRENT'
