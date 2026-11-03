#!/usr/bin/env python3
"""Experimental signed-release-derived floor advance; no production authority."""
import importlib.util
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def advance_verified(config_path, release_path, floor_path, owner_uid=0):
    """Advance only to the sequence authenticated by pinned release verification."""
    verifier = load('trusted-release-verification')
    updater = load('floor-advance')
    def signed_candidate():
        _digest, sequence = verifier.verify(config_path, release_path, owner_uid, floor_path, True)
        return sequence

    return updater.advance(floor_path, None, owner_uid, candidate_provider=signed_candidate)
