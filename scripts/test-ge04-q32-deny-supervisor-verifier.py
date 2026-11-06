import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

P = Path(__file__).with_name('ge04-q32-deny-supervisor-verifier.py')
spec = importlib.util.spec_from_file_location('supervisor_verifier', P)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def test_invalid_binding_denied(self):
        self.assertEqual(mod.classify({'attempt':'x'}), 'INVALID_BINDING')
    def test_wrong_audience_denied(self):
        self.assertEqual(mod.classify(dict.fromkeys(mod.FIELDS, 'x')), 'WRONG_AUDIENCE')
    def test_complete_binding_still_denied(self):
        self.assertEqual(mod.classify({**dict.fromkeys(mod.FIELDS, 'x'), 'audience':'supervisor'}), 'DENIED_SECURITY_HOLD')
    def test_missing_opt_in_holds(self):
        p = subprocess.run([sys.executable, '-B', str(P), '--socket', '/tmp/unused-ge04-supervisor.sock'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertFalse(json.loads(p.stdout)['authorized'])
    @unittest.skipIf(sys.platform != 'linux' or __import__('os').geteuid() == 0, 'nonroot Linux only')
    def test_socket_never_authorizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'verify.sock'
            p = subprocess.Popen([sys.executable, '-B', str(P), '--isolated-test', '--socket', str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                for _ in range(100):
                    if path.exists() or p.poll() is not None: break
                    time.sleep(.02)
                with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as conn:
                    conn.connect(str(path))
                    conn.send(json.dumps({**dict.fromkeys(mod.FIELDS, 'x'), 'audience':'supervisor', 'approved':True}).encode())
                    response = json.loads(conn.recv(4096))
                self.assertFalse(response['authorized'])
                self.assertEqual(response['disposition'], 'HOLD')
                self.assertEqual(p.wait(timeout=5), 78)
            finally:
                if p.poll() is None: p.kill(); p.wait()
                p.stdout.close()
                p.stderr.close()
if __name__ == '__main__': unittest.main()
