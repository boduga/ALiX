#!/usr/bin/env python3
"""GE-04 SUP-12 inert IPC authentication protocol proof; NEVER admission.

A fixture-provisioned secret (not a production trust root) authenticates each
request to one fresh challenge and sequence. Caller still owns key/state.
"""
import hashlib
import hmac
import json
import os

LABEL = b'GE04-SUP12-IPC-TEST-V1\0'
KEY_BYTES = 32
NONCE_BYTES = 32

def _decode(raw: bytes, fields: set):
    if type(raw) is not bytes or not 0 < len(raw) <= 2048:
        raise ValueError('invalid message length')
    def unique(pairs):
        obj = {}
        for name, value in pairs:
            if name in obj: raise ValueError('duplicate key')
            obj[name] = value
        return obj
    payload = json.loads(raw, object_pairs_hook=unique)
    if type(payload) is not dict or set(payload) != fields:
        raise ValueError('invalid message shape')
    return payload

def _hex(value, size):
    return (type(value) is str and len(value) == size * 2 and
            all(c in '0123456789abcdef' for c in value))

def _mac(key, tag, *pieces):
    return hmac.new(key, LABEL + tag + b'\0' + b'\0'.join(pieces), hashlib.sha256).hexdigest()

def _key(key):
    if type(key) is not bytes or len(key) != KEY_BYTES:
        raise ValueError('fixture secret must be 32 bytes')

class TestServer:
    def __init__(self, secret: bytes, bound_peer: bytes):
        _key(secret)
        if type(bound_peer) is not bytes or not 1 <= len(bound_peer) <= 128:
            raise ValueError('missing peer binding')
        self._secret = secret
        self._peer = bound_peer
        self._challenge = None
        self._established = False
        self._session_key = None
        self._last = 0
        self._closed = False

    def issue(self) -> bytes:
        if self._closed or self._challenge is not None or self._established:
            raise PermissionError('challenge reuse')
        self._challenge = os.urandom(NONCE_BYTES)
        return json.dumps({'version': 1, 'challenge': self._challenge.hex()},
                          separators=(',', ':')).encode()

    def establish(self, response: bytes) -> str:
        if self._closed or self._established or self._challenge is None:
            raise PermissionError('no pending challenge')
        # One-shot even when malformed: failed attempt burns this connection.
        challenge = self._challenge
        self._challenge = None
        self._closed = True
        data = _decode(response, {'version', 'proof'})
        if type(data['version']) is not int or data['version'] != 1 or not _hex(data['proof'], 32):
            raise ValueError('invalid response')
        expected = _mac(self._secret, b'handshake', self._peer, challenge)
        if not hmac.compare_digest(data['proof'], expected):
            raise PermissionError('invalid peer proof')
        self._closed = False
        self._session_key = bytes.fromhex(_mac(self._secret, b'session-key', self._peer, challenge))
        self._established = True
        return 'SESSION_OBSERVED_UNTRUSTED'

    def request(self, raw: bytes) -> str:
        if self._closed or not self._established:
            raise PermissionError('session not established')
        data = _decode(raw, {'version', 'sequence', 'attemptId', 'requestDigest', 'mac'})
        sequence = data['sequence']
        attempt = data['attemptId']
        digest = data['requestDigest']
        if (type(data['version']) is not int or data['version'] != 1 or
                type(sequence) is not int or sequence != self._last + 1 or
                type(attempt) is not str or not 1 <= len(attempt) <= 128 or
                not all(x.isascii() and (x.isalnum() or x in '_:-') for x in attempt) or
                not _hex(digest, 32) or not _hex(data['mac'], 32)):
            raise PermissionError('invalid or replayed request')
        expected = _mac(self._session_key, b'request', self._peer,
                        sequence.to_bytes(8, 'big'), attempt.encode(), bytes.fromhex(digest))
        if not hmac.compare_digest(expected, data['mac']):
            raise PermissionError('request authentication failed')
        # A valid sequence is consumed before responding. No durable state:
        # process restart loses it, so this cannot be production authority.
        self._last = sequence
        return 'REQUEST_OBSERVED_UNTRUSTED'

    def close(self):
        self._closed = True
        self._established = False
        self._challenge = None
        self._session_key = None

class TestClient:
    def __init__(self, secret: bytes, bound_peer: bytes):
        _key(secret)
        if type(bound_peer) is not bytes or not 1 <= len(bound_peer) <= 128:
            raise ValueError('missing peer binding')
        self.secret = secret
        self.peer = bound_peer
        self._session_key = None

    def respond(self, challenge: bytes) -> bytes:
        doc = _decode(challenge, {'version', 'challenge'})
        if type(doc['version']) is not int or doc['version'] != 1 or not _hex(doc['challenge'], NONCE_BYTES):
            raise ValueError('invalid challenge')
        challenge_bytes = bytes.fromhex(doc['challenge'])
        proof = _mac(self.secret, b'handshake', self.peer, challenge_bytes)
        self._session_key = bytes.fromhex(_mac(self.secret, b'session-key', self.peer, challenge_bytes))
        return json.dumps({'version': 1, 'proof': proof}, separators=(',', ':')).encode()

    def make_request(self, sequence: int, attempt: str, digest: bytes) -> bytes:
        if type(sequence) is not int or not 1 <= sequence < 2**64 or type(digest) is not bytes or len(digest) != 32:
            raise ValueError('invalid fixture request')
        if self._session_key is None:
            raise PermissionError('no fixture session')
        mac = _mac(self._session_key, b'request', self.peer,
                   sequence.to_bytes(8, 'big'), attempt.encode(), digest)
        return json.dumps({'version': 1, 'sequence': sequence, 'attemptId': attempt,
                           'requestDigest': digest.hex(), 'mac': mac},
                          separators=(',', ':')).encode()
