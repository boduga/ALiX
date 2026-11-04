#!/usr/bin/env python3
"""Descriptor-only GE04 trust and release verification experiment."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(config_path, release_path, owner_uid=0, floor_path=None, return_signed_sequence=False,
           return_verified_bytes=False):
    walk = load('trusted-path')
    reader = load('signed-installation')
    signer = load('signed-release')
    config_fd = walk.open_trusted_directory(config_path, owner_uid)
    try:
        release_fd = walk.open_trusted_directory(release_path, owner_uid)
        try:
            if os.fstat(config_fd).st_ino == os.fstat(release_fd).st_ino and os.fstat(config_fd).st_dev == os.fstat(release_fd).st_dev:
                raise PermissionError('config and release share inode')
            trust = json.loads(reader.read_protected_file(config_fd, 'trust.json', owner_uid, 4096))
            if set(trust) != {'version', 'trustedKeySha256', 'release'} or type(trust['version']) is not int or trust['version'] != 1:
                raise ValueError('invalid trust config')
            pin, release = trust['trustedKeySha256'], trust['release']
            if not isinstance(pin, str) or len(pin) != 64 or any(c not in '0123456789abcdef' for c in pin):
                raise ValueError('invalid trust pin')
            if not isinstance(release, str) or not 0 < len(release) <= 128:
                raise ValueError('invalid release')
            key = reader.read_protected_file(release_fd, 'trusted.pub', owner_uid, 32)
            if hashlib.sha256(key).hexdigest() != pin:
                raise PermissionError('release signing key not trusted')
            manifest = reader.read_protected_file(release_fd, 'manifest.json', owner_uid, 4096)
            signature = reader.read_protected_file(release_fd, 'manifest.sig', owner_uid, 64)
            helper = reader.read_protected_file(release_fd, 'helper', owner_uid, 16 * 1024 * 1024)
            if floor_path is not None:
                sequenced = load('signed-sequence')
                digest = sequenced.verify(manifest, signature, key, helper, release, floor_path, owner_uid)
                if return_verified_bytes:
                    return digest, helper, json.loads(manifest)['sequence']
                if return_signed_sequence:
                    return digest, json.loads(manifest)['sequence']
                return digest
            if return_signed_sequence:
                raise PermissionError('signed sequence requires protected floor')
            if json.loads(manifest).get('version') != 1:
                raise PermissionError('version-2 release requires protected floor')
            digest = signer.verify_release(manifest, signature, key, helper, release)
            if return_verified_bytes:
                return digest, helper, None
            return digest
        finally:
            os.close(release_fd)
    finally:
        os.close(config_fd)
