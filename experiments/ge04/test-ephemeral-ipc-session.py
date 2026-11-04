#!/usr/bin/env python3
"""SUP-12 authenticated *fixture* session: replay and adversarial paths."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location('sup12', Path(__file__).with_name('ephemeral-ipc-session.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

KEY = os.urandom(32)
PEER = b'fixture-coordinator-uid-and-role'
DIGEST = hashlib.sha256(b'inert-operation').digest()

def denied(action, label):
    try: action()
    except (PermissionError, ValueError, TypeError): return
    raise AssertionError('accepted invalid fixture: ' + label)

def session(key=KEY, peer=PEER):
    server = mod.TestServer(key, peer)
    client = mod.TestClient(key, peer)
    challenge = server.issue()
    assert server.establish(client.respond(challenge)) == 'SESSION_OBSERVED_UNTRUSTED'
    return server, client

server, client = session()
first = client.make_request(1, 'attempt-one', DIGEST)
assert server.request(first) == 'REQUEST_OBSERVED_UNTRUSTED'
denied(lambda: server.request(first), 'within-session replay')
denied(lambda: server.request(client.make_request(3, 'attempt-three', DIGEST)), 'sequence gap')
second = client.make_request(2, 'attempt-two', DIGEST)
assert server.request(second) == 'REQUEST_OBSERVED_UNTRUSTED'
altered = json.loads(client.make_request(3, 'attempt-three', DIGEST))
altered['attemptId'] = 'different-attempt'
denied(lambda: server.request(json.dumps(altered).encode()), 'tampered operation binding')
denied(lambda: server.request(client.make_request(3, 'attempt-three', hashlib.sha256(b'other').digest()).replace(b'"version":1', b'"version":2,"version":1')), 'duplicate JSON')
assert server.request(client.make_request(3, 'attempt-three', DIGEST)) == 'REQUEST_OBSERVED_UNTRUSTED'
server.close()
denied(lambda: server.request(first), 'closed session')
denied(lambda: server.issue(), 'closed challenge')

# Fresh connection uses a fresh challenge-derived key and refuses recorded MAC.
server2, client2 = session()
denied(lambda: server2.request(first), 'cross-session replay')
assert server2.request(client2.make_request(1, 'attempt-one', DIGEST)) == 'REQUEST_OBSERVED_UNTRUSTED'

# New server with the same fixture secret must reject old response/challenge.
old = mod.TestServer(KEY, PEER)
old_challenge = old.issue()
old_client = mod.TestClient(KEY, PEER)
old_response = old_client.respond(old_challenge)
fresh = mod.TestServer(KEY, PEER)
fresh.issue()
denied(lambda: fresh.establish(old_response), 'handshake replay')
denied(lambda: fresh.issue(), 'failed handshake reuse')
denied(lambda: fresh.establish(old_response), 'failed handshake retry')

# Wrong secret and peer binding must fail without offering a second chance.
for key, peer in [(os.urandom(32), PEER), (KEY, b'wrong-peer')]:
    victim = mod.TestServer(KEY, PEER)
    challenge = victim.issue()
    rogue = mod.TestClient(key, peer)
    denied(lambda victim=victim, rogue=rogue, challenge=challenge:
           victim.establish(rogue.respond(challenge)), 'wrong key or peer')

# Reject malformed, oversized and duplicate handshake requests.
for candidate in [b'{}', b'a' * 2050, b'{"version":1,"version":1,"proof":"' + b'0'*64 + b'"}']:
    victim = mod.TestServer(KEY, PEER)
    victim.issue()
    denied(lambda victim=victim, candidate=candidate: victim.establish(candidate), 'bad handshake')
    denied(lambda victim=victim: victim.establish(candidate), 'reused failed handshake')

# A client without a challenge cannot manufacture an accepted request.
denied(lambda: mod.TestClient(KEY, PEER).make_request(1, 'a', DIGEST), 'no challenge')
print('GE04 SUP-12 ephemeral IPC authentication PASS: session binding, request MAC, replay and failed handshakes denied')
