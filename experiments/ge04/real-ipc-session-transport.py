#!/usr/bin/env python3
"""SUP-13: bounded Unix-stream composition of SUP-10/11/12; never admission.

Caller supplies fixture secret, coordinator identity and label. An observed
peer, valid MAC or harmless response is not trusted supervisor authorization.
"""
import importlib.util
import os
from pathlib import Path
import socket


def _load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


session = _load('ephemeral-ipc-session')
role = _load('supervisor-role-observation')
MAX_FRAME = 2048


def read_frame(conn):
    """Bounded newline framing, no read-ahead into the next request."""
    data = bytearray()
    while len(data) <= MAX_FRAME:
        chunk = conn.recv(1)
        if not chunk:
            raise ConnectionError('peer disconnected before complete frame')
        if chunk == b'\n':
            if not data:
                raise ValueError('empty frame')
            return bytes(data)
        data.extend(chunk)
    raise ValueError('frame exceeds limit')


def write_frame(conn, payload):
    if type(payload) is not bytes or not 0 < len(payload) <= MAX_FRAME or b'\n' in payload:
        raise ValueError('invalid outgoing frame')
    conn.sendall(payload + b'\n')


def serve_one(endpoint, secret, peer_label, expected_uid, expected_pid,
              expected_exe, expected_start):
    """One attempt per connection. Any failure => UNCERTAIN; never SUCCESS."""
    with endpoint.accept() as conn:
        conn.settimeout(3)
        try:
            if role.inspect(conn, expected_uid, expected_pid, expected_exe,
                            expected_start) != 'ROLE_IDENTITY_OBSERVED_UNTRUSTED':
                raise PermissionError('peer observation failed')
            protocol = session.TestServer(secret, peer_label)
            write_frame(conn, protocol.issue())
            proof = read_frame(conn)
            protocol.establish(proof)
            write_frame(conn, b'SESSION_OBSERVED_UNTRUSTED')
            request = read_frame(conn)
            protocol.request(request)
            write_frame(conn, b'REQUEST_OBSERVED_UNTRUSTED')
            protocol.close()
            return 'TRANSPORT_OUTCOME_UNVERIFIED'
        except (OSError, ValueError, PermissionError, ConnectionError, TimeoutError, UnicodeError):
            return 'UNCERTAIN'


def client_exchange(path, secret, peer_label, request_digest, mode='valid',
                    stolen_proof=None):
    """Test caller only; send inert request digest and collect untrusted text."""
    client = session.TestClient(secret, peer_label)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(3)
        conn.connect(str(path))
        if mode == 'disconnect':
            return 'DISCONNECTED'
        challenge = read_frame(conn)
        proof = stolen_proof if stolen_proof is not None else client.respond(challenge)
        if mode == 'invalid-proof':
            proof = b'{}'
        write_frame(conn, proof)
        if mode in ('invalid-proof', 'stolen-proof'):
            return 'REJECTED_UNVERIFIED'
        result = read_frame(conn)
        if result != b'SESSION_OBSERVED_UNTRUSTED':
            raise AssertionError('unexpected handshake result')
        request = client.make_request(1, 'inert-attempt', request_digest)
        if mode == 'tamper':
            request = request.replace(b'inert-attempt', b'other-attempt')
        if mode == 'oversize':
            conn.sendall(b'x' * 2050 + b'\n')
            return 'SENT_BAD_FRAME'
        if mode == 'request-disconnect':
            return 'DISCONNECTED_AFTER_HANDSHAKE'
        write_frame(conn, request)
        return read_frame(conn).decode('ascii')
