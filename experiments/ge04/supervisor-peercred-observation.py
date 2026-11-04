#!/usr/bin/env python3
"""GE-04 SUP-09 Linux AF_UNIX peer credential observation, never admission.

SO_PEERCRED is kernel-supplied on an accepted stream connection. The expected
UID/PID is fixture-controlled, not an independently authenticated coordinator.
No message, observed peer, or successful result authorizes a mutation.
"""
import json
import os
import socket
import struct
import sys

MAX_BYTES = 2048
FIELDS = frozenset({'version', 'attemptId', 'declaredUid', 'declaredPid'})


def _unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('duplicate request key')
        obj[key] = value
    return obj


def inspect_peer(conn: socket.socket, expected_uid: int, expected_pid: int) -> str:
    """Fail closed unless kernel peer credentials and input match fixture pins."""
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED'):
        raise RuntimeError('Linux SO_PEERCRED required')
    if (type(expected_uid) is not int or expected_uid < 0 or
            type(expected_pid) is not int or expected_pid <= 0):
        raise ValueError('fixture identity pin missing')
    # The accepted socket itself owns the kernel credential observation.
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                          struct.calcsize('3i'))
    pid, uid, _gid = struct.unpack('3i', raw)
    if pid != expected_pid or uid != expected_uid:
        raise PermissionError('kernel peer identity mismatch')
    conn.settimeout(3)
    payload = bytearray()
    while len(payload) <= MAX_BYTES:
        chunk = conn.recv(min(512, MAX_BYTES + 1 - len(payload)))
        if not chunk:
            break
        payload.extend(chunk)
        if b'\n' in chunk:
            break
    if len(payload) > MAX_BYTES or payload.count(b'\n') != 1 or not payload.endswith(b'\n'):
        raise ValueError('invalid request framing')
    data = json.loads(payload, object_pairs_hook=_unique)
    if (type(data) is not dict or set(data) != FIELDS or
            type(data['version']) is not int or data['version'] != 1 or
            type(data['declaredUid']) is not int or
            type(data['declaredPid']) is not int or
            type(data['attemptId']) is not str or
            not 1 <= len(data['attemptId']) <= 128 or
            not all(c.isascii() and (c.isalnum() or c in '-_:') for c in data['attemptId']) or
            data['declaredUid'] != uid or data['declaredPid'] != pid):
        raise PermissionError('untrusted or mismatched declared identity')
    # Peer observation alone does not establish role, authorization, or receipt.
    return 'PEER_OBSERVED_UNTRUSTED'
