"""GE-04 R2S qualification-only mutual TLS and role-bound request guard.

No listener is created here. Only a TLS server configured to require client
certificates may call authorize_client. The role map must be independently
provisioned and is NOT a substitute for a protected witness floor.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import stat

_HEX = re.compile(r"[0-9a-f]{64}")
_ALLOWED = {"verifier", "publisher", "committer", "security-operator"}
_IDENTITY_KEYS = {"fingerprintSha256", "principalId", "role"}
_MANIFEST_KEYS = {"schema", "serviceId", "identities"}

def _secure_file(path):
    p = Path(path)
    if not p.is_absolute() or p.is_symlink():
        raise PermissionError("must use an absolute, non-symlink trust file")
    st = os.lstat(p)
    if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or
            st.st_uid != 0 or stat.S_IMODE(st.st_mode) & 0o022):
        raise PermissionError("trust file requires trusted root ownership")
    return p

def load_identities(path):
    """Read-only qualification manifest; caller must protect its directory ancestry."""
    p = _secure_file(path)
    if p.stat().st_size > 16384:
        raise ValueError("identity manifest too large")
    data = json.loads(p.read_text())
    if (type(data) is not dict or set(data) != _MANIFEST_KEYS or
            data["schema"] != "ge04-r2s-identity-v1" or
            data["serviceId"] != "alix-ge04-r2q-qualifier" or
            type(data["identities"]) is not list or
            not 1 <= len(data["identities"]) <= 32):
        raise ValueError("invalid service identity manifest")
    result = {}
    principals = set()
    for identity in data["identities"]:
        if (type(identity) is not dict or set(identity) != _IDENTITY_KEYS or
                type(identity["fingerprintSha256"]) is not str or
                not _HEX.fullmatch(identity["fingerprintSha256"]) or
                type(identity["principalId"]) is not str or
                not 1 <= len(identity["principalId"]) <= 128 or
                any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._" for c in identity["principalId"]) or
                identity["role"] not in _ALLOWED):
            raise ValueError("invalid client identity")
        fingerprint = identity["fingerprintSha256"]
        principal = identity["principalId"]
        if fingerprint in result or principal in principals:
            raise ValueError("duplicated client certificate or identity")
        principals.add(principal)
        result[fingerprint] = (principal, identity["role"])
    return result

def tls_context(cert_path, key_path, ca_path):
    """Require TLS 1.3 and mutual certificate authentication; never fall back."""
    for item in (cert_path, key_path, ca_path):
        _secure_file(item)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.check_hostname = False
    ctx.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
    ctx.load_verify_locations(cafile=str(ca_path))
    return ctx

def authorize_client(tls_connection, identities, method, path):
    """Allow only verifier role for the current read/challenge API."""
    if not isinstance(tls_connection, ssl.SSLSocket):
        return False
    try:
        cert = tls_connection.getpeercert(binary_form=True)
    except (OSError, ssl.SSLError):
        return False
    if not cert:
        return False
    record = identities.get(hashlib.sha256(cert).hexdigest())
    if record is None:
        return False
    _, role = record
    if method == "GET" and path == "/health":
        return role == "verifier"
    if method == "POST" and path == "/challenge":
        return role == "verifier"
    return False
