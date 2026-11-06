#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

PATH = Path(__file__).with_name('ge04-q32-deny-issuer-service.py')
spec = importlib.util.spec_from_file_location('q32_deny_service', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def test_constant_denial(self):
        self.assertEqual(mod.DENIAL, b'DENIED GE04_SECURITY_HOLD\n')
    def test_no_opt_in(self):
        p = subprocess.run([sys.executable, '-B', str(PATH), '--socket', '/tmp/no-socket'], capture_output=True)
        self.assertEqual(p.returncode, 78)
    def test_root_or_bad_path_rejected(self):
        with self.assertRaises(ValueError):
            mod.serve('relative')
    def test_untrusted_parent_rejected(self):
        if os.geteuid() == 0:
            self.skipTest('requires nonroot test runner')
        with self.assertRaises(ValueError):
            mod.serve('/tmp/test-q32-untrusted.sock')
    def test_denial_over_socket(self):
        if os.geteuid() == 0:
            self.skipTest('requires nonroot test runner')
        with tempfile.TemporaryDirectory(prefix='q32-issuer-test-') as root:
            os.chmod(root, 0o700)
            sockpath = str(Path(root) / 'issuer.sock')
            p = subprocess.Popen([sys.executable, '-B', str(PATH), '--isolated-test', '--socket', sockpath], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    if Path(sockpath).exists():
                        break
                    time.sleep(.01)
                with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as conn:
                    conn.connect(sockpath)
                    conn.sendall(b'{"approve":true,"issuer":"trusted"}')
                    self.assertEqual(conn.recv(4096), mod.DENIAL)
                out, err = p.communicate(timeout=5)
                self.assertEqual(p.returncode, 78, (out, err))
                self.assertFalse(Path(sockpath).exists())
            finally:
                if p.poll() is None:
                    p.kill()
                    p.wait()

if __name__ == '__main__':
    unittest.main()
