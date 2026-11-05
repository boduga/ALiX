#!/usr/bin/env python3
"""Operator-only synthetic cross-UID connected-socket delegation experiment."""
import argparse
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile
import time

SERVICE = Path(__file__).with_name('ge04-q32-deny-supervisor-verifier.py')
BASE = {'gate':'GE04_Q32_SUPERVISOR_CONNECTED_FD', 'disposition':'HOLD',
        'qualified_independent_issuance':False, 'real_effects_performed':0}
CONNECTOR = '''import array,os,socket,sys,json
c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.connect(sys.argv[1]);
relay=socket.socket(fileno=int(sys.argv[2]));relay.sendmsg([b'synthetic'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[c.fileno()]))]);
print(json.dumps({'connector_uid':os.geteuid(),'sent':True}))
'''
ATTACKER = '''import array,os,socket,sys,json
relay=socket.socket(fileno=int(sys.argv[1]));data,anc,flags,addr=relay.recvmsg(128,socket.CMSG_SPACE(4));
fds=array.array('i');
for level,kind,payload in anc:
 if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:fds.frombytes(payload[:len(payload)//4*4])
if len(fds)!=1:raise RuntimeError('expected one delegated descriptor')
c=socket.socket(fileno=fds[0]);c.settimeout(3);
c.send(json.dumps({'attempt':'synthetic','generation':'1','nonce':'n','audience':'supervisor','operation':'synthetic','target_digest':'d','policy_revision':'1','approved':True}).encode());
print(json.dumps({'attacker_uid':os.geteuid(),'delegated_send':True,'response':json.loads(c.recv(4096))}))
'''

def drop(uid,gid):
    def apply():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
    return apply

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--isolated-test',action='store_true')
    p.add_argument('--supervisor',required=True)
    p.add_argument('--attacker',required=True)
    args=p.parse_args()
    if not args.isolated_test or sys.platform!='linux' or os.geteuid()!=0:
        print(json.dumps({**BASE,'reason':'root operator and isolated-test required'}));return 78
    try:
        sup=pwd.getpwnam(args.supervisor);atk=pwd.getpwnam(args.attacker)
        if 0 in (sup.pw_uid,atk.pw_uid) or sup.pw_uid==atk.pw_uid:
            raise ValueError('distinct nonroot accounts required')
        with tempfile.TemporaryDirectory(prefix='ge04-connected-fd-') as tmp:
            os.chown(tmp,sup.pw_uid,sup.pw_gid);os.chmod(tmp,0o711)
            path=Path(tmp)/'verify.sock'
            server=subprocess.Popen([sys.executable,'-B',str(SERVICE),'--isolated-test','--socket',str(path)],preexec_fn=drop(sup.pw_uid,sup.pw_gid),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                for _ in range(150):
                    if path.exists() or server.poll() is not None:break
                    time.sleep(.02)
                a,b=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
                try:
                    connector=subprocess.run([sys.executable,'-B','-c',CONNECTOR,str(path),str(a.fileno())],pass_fds=(a.fileno(),),preexec_fn=drop(sup.pw_uid,sup.pw_gid),capture_output=True,text=True,timeout=5,check=True)
                    attacker=subprocess.run([sys.executable,'-B','-c',ATTACKER,str(b.fileno())],pass_fds=(b.fileno(),),preexec_fn=drop(atk.pw_uid,atk.pw_gid),capture_output=True,text=True,timeout=5,check=True)
                finally:
                    a.close();b.close()
                report=json.loads(attacker.stdout)
                server.communicate(timeout=5)
                observed=(report['delegated_send'] and report['attacker_uid']==atk.pw_uid and report['response']['authorized'] is False and server.returncode==78)
                print(json.dumps({**BASE,'connector':json.loads(connector.stdout),'attacker':report,'service_exit':server.returncode,'delegation_observed_and_denied':observed},sort_keys=True))
            finally:
                if server.poll() is None:server.kill();server.wait()
                server.stdout.close();server.stderr.close()
    except (OSError,ValueError,subprocess.SubprocessError) as exc:
        print(json.dumps({**BASE,'reason':type(exc).__name__,'detail':str(exc)[:180]}))
    return 78
if __name__=='__main__':raise SystemExit(main())
