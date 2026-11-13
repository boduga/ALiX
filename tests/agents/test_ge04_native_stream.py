"""Bounded native transport probes. No production broker or worker admission.

Live cases require the designated disposable root VM and explicit flags. Each
process has a 10s fixture watchdog; this is not an agent execution deadline.
"""
import array
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENABLED = (sys.platform == "linux" and os.getuid() == 0
           and os.environ.get("ALIX_GE04_PRIVILEGED_QUALIFICATION") == "1")
CLIENT = r'''
import array,ctypes,os,socket,struct,sys,time
path,uid,scenario,go=sys.argv[1],int(sys.argv[2]),sys.argv[3],int(sys.argv[4])
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(38,1,0,0,0): raise OSError(ctypes.get_errno(),'no_new_privs')
os.setgroups([]);os.setresgid(uid,uid,uid);os.setresuid(uid,uid,uid)
print('READY',flush=True)
permit=os.read(go,1);os.close(go)
if permit!=b'1': sys.exit(0)
def frame(data): return b'ALX1'+struct.pack('!I',len(data))+data
def exact(s,n):
 out=b''
 while len(out)<n:
  part=s.recv(n-len(out))
  if not part: break
  out+=part
 return out
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(5)
data=b''
try:
 s.connect(path)
 if scenario=='fragmented':
  for b in frame(b'hello'): s.sendall(bytes([b]));time.sleep(.002)
  data=exact(s,13)
 elif scenario=='coalesced':
  s.sendall(frame(b'one')+frame(b'two'));data=exact(s,22)
 elif scenario=='opaque':
  payload=b'{"pid":1,"uid":0,"attempt":99}'
  s.sendall(frame(payload));data=exact(s,8+len(payload))
 elif scenario=='between':
  s.sendall(frame(b'one'));data=exact(s,11);print('FIRST',flush=True)
  sys.stdin.buffer.read(1);s.sendall(frame(b'two'));data+=s.recv(1024)
 elif scenario=='backpressure':
  s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,4096)
  s.sendall(frame(b'x'));print('SENT',flush=True)
  sys.stdin.buffer.read(1)
 elif scenario in ('delegate','mixed'):
  message=frame(b'forged')
  if scenario=='mixed':s.sendall(message[:4]);message=message[4:]
  child=os.fork()
  if child==0:
   try:s.sendall(message)
   finally:os._exit(0)
  os.waitpid(child,0);data=s.recv(1024)
 elif scenario in ('rights1','rights32'):
  fd=os.open('/dev/null',os.O_RDONLY)
  try:s.sendmsg([frame(b'x')],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[fd]*(32 if scenario=='rights32' else 1)))])
  finally:os.close(fd)
  data=s.recv(1024)
 else:
  message={'badmagic':b'BAD!'+struct.pack('!I',1)+b'x',
    'zero':b'ALX1'+struct.pack('!I',0),
    'oversize':b'ALX1'+struct.pack('!I',65537),
    'header_eof':b'ALX', 'body_eof':b'ALX1'+struct.pack('!I',3)+b'x',
    'partial':b'ALX1'+struct.pack('!I',3)+b'x',
    'exitread':b'ALX1'+struct.pack('!I',3)+b'x'}.get(scenario,b'')
  if message:s.sendall(message)
  if scenario in ('header_eof','body_eof'):s.shutdown(socket.SHUT_WR)
  if scenario in ('partial','exitread'):print('PARTIAL',flush=True)
  if scenario=='exitread':sys.stdin.buffer.read(1)
  else:data=s.recv(1024)
except (OSError,TimeoutError) as e:
 print('ERROR '+type(e).__name__,flush=True)
finally:
 s.close();print('DATA '+data.hex(),flush=True)
# Keep the registered process alive through native final validation/response.
if scenario not in ('exitread','backpressure'):sys.stdin.buffer.read(1)
'''


class _NativeStreamCompilation:

    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or not shutil.which("cc"):
            raise unittest.SkipTest("Linux compiler required; skip is not qualification")
        cls.build = tempfile.TemporaryDirectory(prefix="ge04-stream-build-", dir="/run" if ENABLED else None)
        cls.addClassCleanup(cls.build.cleanup)
        cls.binary = str(Path(cls.build.name) / "probe")
        subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", "-O2", "-o", cls.binary,
                        str(ROOT / "tests/fixtures/ge04-native-stream-probe.c"),
                        str(ROOT / "native/ge04/worker-stream.c")], check=True,
                       capture_output=True, text=True, timeout=30)


class NativeStreamBuild(_NativeStreamCompilation, unittest.TestCase):
    def test_invalid_arguments_refuse(self):
        for args in ([], ["/run/peer.sock", "-1", "2", "2", "1", "3", "echo1", "100"],
                     ["/run/peer.sock", "2", "2", "2", "18446744073709551616", "3", "echo1", "100"],
                     ["/run/peer.sock", "2", "2", "2", "1", "3", "echo1", "99"]):
            with self.subTest(args=args):
                result = subprocess.run([self.binary, *args], capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 64)
                self.assertNotIn(b"READY", result.stdout)

    @unittest.skipIf(os.getuid() == 0, "unprivileged-only refusal; root does not qualify it")
    def test_unprivileged_composition_refuses(self):
        result = subprocess.run([self.binary, "/run/ge04-stream-test-unused/peer.sock", "2",
                                 "20002", "20002", "1", "3", "echo1", "100"],
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 77)
        self.assertNotIn(b"READY", result.stdout)


@unittest.skipUnless(ENABLED, "requires explicitly authorized disposable root VM; skip is not qualification")
class NativeStreamLive(_NativeStreamCompilation, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.uid = int(os.environ["ALIX_GE04_TEST_WORKER_UID"])
        if cls.uid <= 0 or cls.uid > 0xFFFFFFFF:
            raise ValueError("nonzero reserved synthetic UID required")
        st = os.stat("/run")
        if st.st_uid != 0 or st.st_mode & 0o022:
            raise RuntimeError("untrusted /run")

    def line(self, process):
        if not select.select([process.stdout], [], [], 5)[0]:
            self.fail("fixture progress barrier timed out")
        return process.stdout.readline().decode().strip()

    def case(self, scenario, expected=77, mode="echo1", action=None, peer_override=None, ctrunc=0):
        # Only this fresh synthetic directory and our direct child processes are cleaned.
        with tempfile.TemporaryDirectory(prefix="ge04-stream-test-", dir="/run") as directory:
            os.chmod(directory, 0o711)
            path = str(Path(directory) / "peer.sock")
            go_read, go_write = os.pipe()
            client = server = None
            cancel_read = cancel_write = None
            server_lines = []
            try:
                client = subprocess.Popen([sys.executable, "-I", "-u", "-c", CLIENT,
                                           path, str(self.uid), scenario, str(go_read)],
                                          pass_fds=(go_read,), stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
                os.close(go_read); go_read = None
                self.assertEqual(self.line(client), "READY")
                stat = Path(f"/proc/{client.pid}/stat").read_text()
                ticks = stat[stat.rindex(")") + 2:].split()[19]
                peer = dict(pid=client.pid, uid=self.uid, gid=self.uid, ticks=ticks)
                if peer_override:
                    peer.update(peer_override(peer))
                if scenario == "dead":
                    os.close(go_write); go_write = None
                    client.communicate(timeout=10)
                cancel_read, cancel_write = os.pipe()
                if action == "pre_cancel":
                    os.write(cancel_write, b"x")
                args = [self.binary, path, str(peer["pid"]), str(peer["uid"]),
                        str(peer["gid"]), str(peer["ticks"]), str(cancel_read), mode,
                        "2000" if expected == 0 else "500"]
                server = subprocess.Popen(args, pass_fds=(cancel_read,), stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, bufsize=0)
                os.close(cancel_read); cancel_read = None
                server_lines.append(self.line(server))
                self.assertEqual(server_lines[-1], "READY")
                # Keep the restricted child waiting for accept-timeout/control cases.
                if action not in ("no_connect", "pre_cancel") and scenario != "dead":
                    os.write(go_write, b"1"); os.close(go_write); go_write = None
                if action in ("cancel_read", "hup_read", "exit_read"):
                    self.assertEqual(self.line(client), "PARTIAL")
                elif action == "between":
                    self.assertEqual(self.line(client), "FIRST")
                elif mode == "backpressure":
                    self.assertEqual(self.line(client), "SENT")
                    server_lines.append(self.line(server))
                    self.assertEqual(server_lines[-1], "WRITE")
                if action in ("cancel_read", "between", "cancel_write"):
                    os.write(cancel_write, b"x")
                elif action == "hup_read":
                    os.close(cancel_write); cancel_write = None
                if action in ("between", "exit_read", "exit_write"):
                    client.stdin.write(b"x"); client.stdin.flush()
                tail, errors = server.communicate(timeout=10)
                server_lines.append(tail.decode())
                errors = errors.decode()
                output = "\n".join(server_lines)
                self.assertEqual(server.returncode, expected, output + errors)
                status = 0 if expected == 0 else 2 if expected == 75 else 1
                self.assertIn(f"RESULT status={status} retry={1 if status else 0} fd_delta=0", output)
                self.assertIn(f"ctrunc={ctrunc}", output)
                if go_write is not None:
                    os.close(go_write); go_write = None
                remaining, client_errors = client.communicate(input=b"xx" if client.poll() is None else None, timeout=10)
                remaining = remaining.decode()
                self.assertEqual(client.returncode, 0, client_errors.decode())
                if expected == 0:
                    payload = {"fragmented": b"hello", "coalesced": b"one", "opaque": b'{"pid":1,"uid":0,"attempt":99}'}[scenario]
                    import struct
                    wanted = b"ALX1" + struct.pack("!I", len(payload)) + payload
                    if scenario == "coalesced":
                        wanted += b"ALX1\0\0\0\3two"
                    self.assertIn("DATA " + wanted.hex(), remaining)
                elif action == "between":
                    self.assertIn("DATA 414c5831000000036f6e65", remaining)
                    self.assertNotIn("74776f", remaining)
                elif action in ("no_connect", "pre_cancel"):
                    self.assertEqual(remaining, "", "client never received connection permission")
                elif scenario not in ("dead", "backpressure"):
                    self.assertIn("DATA \n", remaining)
                self.assertFalse(Path(path).exists(), "harness must remove only its socket")
            finally:
                for fd in (go_read, go_write, cancel_read, cancel_write):
                    if fd is not None:
                        os.close(fd)
                for process in (server, client):
                    if process is not None:
                        if process.poll() is None:
                            process.kill()  # exact fixture-owned direct child only
                        process.communicate(timeout=10)

    def test_fragmented_frame(self): self.case("fragmented", 0)
    def test_coalesced_frames(self): self.case("coalesced", 0, "echo2")
    def test_fake_identity_is_only_opaque_data(self): self.case("opaque", 0)
    def test_wrong_uid(self): self.case("none", peer_override=lambda p: {"uid": p["uid"] + 1})
    def test_wrong_gid(self): self.case("none", peer_override=lambda p: {"gid": p["gid"] + 1})
    def test_wrong_pid(self): self.case("none", peer_override=lambda p: {"pid": os.getpid()})
    def test_wrong_generation(self): self.case("none", peer_override=lambda p: {"ticks": str(int(p["ticks"]) + 1)})
    def test_same_supervisor_uid(self): self.case("none", peer_override=lambda p: {"uid": 0})
    def test_dead_peer(self): self.case("dead")
    def test_bad_magic(self): self.case("badmagic")
    def test_zero_length(self): self.case("zero")
    def test_oversize_length(self): self.case("oversize")
    def test_partial_header_disconnect(self): self.case("header_eof")
    def test_partial_body_disconnect(self): self.case("body_eof")
    def test_read_timeout(self): self.case("partial", 75)
    def test_accept_timeout(self): self.case("none", 75, action="no_connect")
    def test_write_timeout(self): self.case("backpressure", 75, "backpressure")
    def test_delegated_sender(self): self.case("delegate")
    def test_mixed_senders(self): self.case("mixed")
    def test_rights_rejected_and_closed(self): self.case("rights1")
    def test_truncated_rights_rejected_and_closed(self): self.case("rights32", ctrunc=1)
    def test_cancel_before_accept(self): self.case("none", action="pre_cancel")
    def test_cancel_incomplete_read(self): self.case("partial", action="cancel_read")
    def test_cancel_between_frames(self): self.case("between", mode="echo2", action="between")
    def test_cancel_write_phase(self): self.case("backpressure", mode="backpressure", action="cancel_write")
    def test_cancel_pipe_hup(self): self.case("partial", action="hup_read")
    def test_peer_exit_read(self): self.case("exitread", action="exit_read")
    def test_peer_exit_write(self): self.case("backpressure", mode="backpressure", action="exit_write")
    def test_blocking_listener_refuses(self): self.case("none", mode="blocking-listener")


if __name__ == "__main__":
    unittest.main()
