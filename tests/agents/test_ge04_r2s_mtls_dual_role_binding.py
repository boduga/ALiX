"""Real ephemeral mTLS role-binding qualification; NO production HTTP routes."""
import datetime
import hashlib
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import tempfile
import threading
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT=Path(__file__).resolve().parents[2]/"scripts"
spec=importlib.util.spec_from_file_location("ge04_dual_role_qual",ROOT/"ge04-r2s-mtls-dual-role-binding.py")
binder_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(binder_module)

# Existing ephemeral CA fixtures, never production keys/certificates.
helper_spec=importlib.util.spec_from_file_location(
    "ge04_tls_test_helpers",Path(__file__).with_name("test_ge04_r2s_transport_guard.py"))
helpers=importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helpers)


class TwoRoleBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="ge04-mtls-roles-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        ca_key,ca_cert=helpers.make_ca()
        self.ca=self.save("ca.pem",ca_cert.public_bytes(serialization.Encoding.PEM))
        self.clients={}
        mapping={}
        for role in ("publisher","committer","verifier","unknown"):
            key,cert=helpers.make_cert(ca_key,ca_cert,role)
            key_path=self.save(role+".key",key.private_bytes(
                serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()))
            cert_path=self.save(role+".pem",cert.public_bytes(serialization.Encoding.PEM))
            fingerprint=hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()
            self.clients[role]=(key_path,cert_path,fingerprint)
            if role!="unknown":mapping[fingerprint]=(role+"-principal",role)
        key,cert=helpers.make_cert(ca_key,ca_cert,"server",server=True)
        key_path=self.save("server.key",key.private_bytes(
            serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        cert_path=self.save("server.pem",cert.public_bytes(serialization.Encoding.PEM))
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version=ssl.TLSVersion.TLSv1_3
        context.verify_mode=ssl.CERT_REQUIRED
        context.load_cert_chain(str(cert_path),str(key_path))
        context.load_verify_locations(cafile=str(self.ca))
        self.binder=binder_module.QualificationDualRoleBinder(
            mapping,anchor_id="anchor-a",epoch="epoch-a")
        owner=self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                try:
                    length=int(self.headers.get("Content-Length","-1"))
                    if not 1<=length<=8192:
                        self.send_error(400)
                        return
                    raw=self.rfile.read(length)
                    if self.path=="/fixture/publisher":
                        result=owner.binder.publisher_observation(self.connection,raw)
                    elif self.path=="/fixture/committer":
                        result=owner.binder.committer_observation(self.connection,raw)
                    else:
                        self.send_error(404)
                        return
                    data=json.dumps(result).encode()
                    self.send_response(200)
                    self.send_header("Content-Length",str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (OSError,ValueError):
                    self.send_error(400)
            def log_message(self,*_):
                pass
        self.server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        self.server.socket=context.wrap_socket(self.server.socket,server_side=True)
        self.addCleanup(self.server.server_close)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.server.shutdown)
        self.url="https://127.0.0.1:"+str(self.server.server_port)
        self.body={
            "schema":binder_module.SCHEMA,"requestId":"enrollment-request-00001",
            "anchorId":"anchor-a","epoch":"epoch-a","proposalSha256":"a"*64,
            "expectedRevision":0,"expectedHeadSha256":"0"*64,
        }

    def save(self,name,bytes_data):
        p=self.root/name
        p.write_bytes(bytes_data)
        return p

    def call(self,role,kind,body=None):
        ctx=ssl.create_default_context(cafile=str(self.ca))
        if role is not None:
            key,cert,_=self.clients[role]
            ctx.load_cert_chain(str(cert),str(key))
        data=json.dumps(self.body if body is None else body,
                        separators=(",",":"),sort_keys=True).encode() if type(body) is not bytes else body
        request=Request(self.url+"/fixture/"+kind,data=data,
                        headers={"Content-Type":"application/json"})
        with urlopen(request,context=ctx,timeout=5) as response:
            return json.load(response)

    def test_real_tls_separate_roles_consistent_never_authorize(self):
        first=self.call("publisher","publisher")
        self.assertTrue(first["publisherObserved"])
        final=self.call("committer","committer")
        self.assertTrue(final["rolesBound"])
        self.assertEqual(final["status"],"blocked")
        self.assertFalse(final["authorizationGranted"])
        self.assertFalse(final["rollbackResistant"])

    def test_verifier_and_unknown_cannot_claim_roles(self):
        for role in ("verifier","committer","unknown"):
            with self.subTest(role=role):
                self.assertFalse(self.call(role,"publisher").get("publisherObserved",False))
        for role in ("verifier","publisher","unknown"):
            with self.subTest(role=role):
                self.assertFalse(self.call(role,"committer").get("rolesBound",False))

    def test_missing_client_cert_rejected_in_tls(self):
        with self.assertRaises((ssl.SSLError,URLError,OSError)):
            self.call(None,"publisher")

    def test_commit_before_publisher_and_replay_denied(self):
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))
        self.call("publisher","publisher")
        self.assertTrue(self.call("committer","committer")["rolesBound"])
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))
        self.assertFalse(self.call("publisher","publisher").get("publisherObserved",False))

    def test_changed_proposal_digest_denied_and_token_spent(self):
        self.call("publisher","publisher")
        altered={**self.body,"proposalSha256":"f"*64}
        self.assertFalse(self.call("committer","committer",altered).get("rolesBound",False))
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))

    def test_changed_epoch_denied(self):
        altered={**self.body,"epoch":"epoch-b"}
        self.assertFalse(self.call("publisher","publisher",altered).get("publisherObserved",False))
        self.assertFalse(self.call("committer","committer",altered).get("rolesBound",False))

    def test_reused_id_with_altered_publisher_claim_denied(self):
        self.call("publisher","publisher")
        altered={**self.body,"proposalSha256":"f"*64}
        self.assertFalse(self.call("publisher","publisher",altered).get("publisherObserved",False))

    def test_duplicate_json_and_nonfinite_values_denied(self):
        for raw in (b'{"requestId":"x","requestId":"y"}',
                    b'{"expectedRevision":NaN}',b'x'*8193):
            with self.subTest(raw=raw[:20]):
                if len(raw)>8192:
                    with self.assertRaises(HTTPError) as caught:
                        self.call("publisher","publisher",raw)
                    self.assertEqual(caught.exception.code,400)
                    caught.exception.close()
                else:
                    response=self.call("publisher","publisher",raw)
                    self.assertFalse(response.get("publisherObserved",False))

    def test_invalid_boolean_revision_denied(self):
        raw={**self.body,"expectedRevision":True}
        self.assertFalse(self.call("publisher","publisher",raw).get("publisherObserved",False))

    def test_same_role_principal_cannot_self_endorse_even_if_misconfigured(self):
        fp_p=self.clients["publisher"][2]
        fp_c=self.clients["committer"][2]
        self.binder._identities[fp_c]=("publisher-principal","committer")
        self.call("publisher","publisher")
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))

    def test_distinct_certificate_same_fingerprint_mapping_rejects_wrong_role(self):
        fp_c=self.clients["committer"][2]
        self.binder._identities[fp_c]=("committer-principal","publisher")
        self.call("publisher","publisher")
        self.assertFalse(self.call("committer","committer").get("rolesBound",False))


if __name__=="__main__":
    unittest.main()
