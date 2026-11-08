"""R2S isolated mutual-TLS role enforcement; no machine configuration changes."""
import datetime
import hashlib
import importlib.util
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import ssl
import tempfile
import threading
import unittest
from unittest import mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

SOURCE = Path(__file__).resolve().parents[2] / "scripts"
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, SOURCE / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

guard = load("ge04-r2s-transport-guard.py", "r2s_transport")
witness = load("ge04-r2q-witness-service.py", "r2s_witness")


def make_ca():
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "GE04 isolated test CA")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .sign(key, hashes.SHA256()))
    return key, cert


def make_cert(ca_key, ca_cert, name, *, server=False):
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.timezone.utc)
    cn = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    builder = (x509.CertificateBuilder().subject_name(cn).issuer_name(ca_cert.subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(hours=1))
        .add_extension(x509.ExtendedKeyUsage([
            x509.oid.ExtendedKeyUsageOID.SERVER_AUTH if server
            else x509.oid.ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False))
    if server:
        import ipaddress
        builder = builder.add_extension(x509.SubjectAlternativeName([
            x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
    return key, builder.sign(ca_key, hashes.SHA256())


class R2STransportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="r2s-tls-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        ca_key, ca_cert = make_ca()
        self.ca = self.save("ca.pem", ca_cert.public_bytes(serialization.Encoding.PEM))
        self.clients = {}
        for role in ("verifier", "publisher", "committer", "security-operator", "unknown"):
            k, cert = make_cert(ca_key, ca_cert, role)
            key_path = self.save(role+".key", k.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()))
            cert_path = self.save(role+".pem", cert.public_bytes(serialization.Encoding.PEM))
            self.clients[role] = (key_path, cert_path, hashlib.sha256(
                cert.public_bytes(serialization.Encoding.DER)).hexdigest())
        key, cert = make_cert(ca_key, ca_cert, "witness-server", server=True)
        server_key = self.save("server.key", key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        server_cert = self.save("server.pem", cert.public_bytes(serialization.Encoding.PEM))
        mapping = {
            "schema": "ge04-r2s-identity-v1",
            "serviceId": witness.WITNESS_ID,
            "identities": [
                {"fingerprintSha256": self.clients[role][2],
                 "principalId": role+"-client", "role": role}
                for role in ("verifier", "publisher", "committer", "security-operator")
            ]}
        self.manifest = self.save("identities.json", json.dumps(mapping).encode())
        self.patch_secure = mock.patch.object(guard, "_secure_file", lambda x: Path(x))
        self.patch_secure.start()
        self.addCleanup(self.patch_secure.stop)
        self.identities = guard.load_identities(self.manifest)
        self.context = guard.tls_context(server_cert, server_key, self.ca)
        self.assertEqual(self.context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(self.context.minimum_version, ssl.TLSVersion.TLSv1_3)
        db = str(self.root / "head.sqlite")
        signing_key = str(self.root / "signing.key")
        pub = str(self.root / "pub.hex")
        with mock.patch.object(witness.os, "geteuid", return_value=0):
            witness.initialize(db, signing_key, pub)
            witness.append_head(db, 1, "a"*64, "b"*64)
        self.db = db
        self.signer = witness.load_signer(signing_key)
        def authorize(conn, method, path):
            return guard.authorize_client(conn, self.identities, method, path)
        handler = witness.handler_factory(db, self.signer, authorize=authorize)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.server.socket = self.context.wrap_socket(self.server.socket, server_side=True)
        self.addCleanup(self.server.server_close)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.server.shutdown)
        self.base = f"https://127.0.0.1:{self.server.server_port}"

    def save(self, name, content):
        path = self.root / name
        path.write_bytes(content)
        return path

    def request(self, role, endpoint="/challenge"):
        ctx = ssl.create_default_context(cafile=str(self.ca))
        if role is not None:
            key, cert, _ = self.clients[role]
            ctx.load_cert_chain(str(cert), str(key))
        if endpoint == "/challenge":
            payload = json.dumps({"nonce": "c"*64, "bootId": "qual-boot"}).encode()
            req = Request(self.base+endpoint, data=payload,
                          headers={"Content-Type": "application/json"})
        else:
            req = Request(self.base+endpoint)
        return urlopen(req, context=ctx, timeout=3)

    def test_verifier_can_read_signed_challenge_but_not_authorize(self):
        with self.request("verifier") as response:
            data = json.load(response)
        self.assertEqual(data["payload"]["revision"], "1")
        self.assertNotIn("authorizationGranted", data)

    def test_verifier_health_not_authorization(self):
        with self.request("verifier", "/health") as response:
            data = json.load(response)
        self.assertFalse(data["authorization"])

    def test_wrong_roles_cannot_challenge(self):
        for role in ("publisher", "committer", "security-operator", "unknown"):
            with self.subTest(role=role), self.assertRaises(HTTPError) as caught:
                self.request(role)
            self.assertEqual(caught.exception.code,403)

    def test_wrong_roles_cannot_read_health(self):
        for role in ("publisher", "committer", "security-operator"):
            with self.subTest(role=role), self.assertRaises(HTTPError) as caught:
                self.request(role,"/health")
            self.assertEqual(caught.exception.code,403)

    def test_no_client_certificate_fails_tls(self):
        with self.assertRaises((ssl.SSLError, URLError, OSError)):
            self.request(None)

    def test_unmapped_authorized_ca_identity_fails(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("unknown")
        self.assertEqual(caught.exception.code,403)

    def test_no_mutation_route_even_for_verifier(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("verifier", "/commit")
        self.assertEqual(caught.exception.code,403)

    def test_invalid_client_role_or_duplicate_fingerprint_blocks(self):
        raw=json.loads(self.manifest.read_text())
        raw["identities"][0]["role"]="worker"
        self.manifest.write_text(json.dumps(raw))
        with self.assertRaises(ValueError):
            guard.load_identities(self.manifest)
        raw["identities"][0]["role"]="verifier"
        raw["identities"][1]["fingerprintSha256"]=raw["identities"][0]["fingerprintSha256"]
        self.manifest.write_text(json.dumps(raw))
        with self.assertRaises(ValueError):
            guard.load_identities(self.manifest)


if __name__ == "__main__":
    unittest.main()
