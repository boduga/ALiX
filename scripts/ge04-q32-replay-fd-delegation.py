#!/usr/bin/env python3
"""Disposable replay-ledger file descriptor delegation probe; HOLD only."""
import argparse
import array
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import sqlite3
import sys
import tempfile

BASE={'gate':'GE04_Q32_REPLAY_FD_DELEGATION','disposition':'HOLD',
      'qualified_independent_issuance':False,'real_effects_performed':0}

def drop(user):
    os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)

def child(user, role, channel, fixture, writable):
    try:
        drop(user)
        if role=='issuer':
            fd=os.open(fixture,os.O_RDWR if writable else os.O_RDONLY)
            try:channel.sendmsg([b'fd'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[fd]))])
            finally:os.close(fd)
            return {'uid':os.geteuid(),'sent':True}
        data,anc,flags,_=channel.recvmsg(16,socket.CMSG_SPACE(array.array('i').itemsize))
        fds=array.array('i')
        for level,kind,payload in anc:
            if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
                fds.frombytes(payload[:len(payload)-len(payload)%fds.itemsize])
        if data!=b'fd' or flags & (socket.MSG_TRUNC|socket.MSG_CTRUNC) or len(fds)!=1:
            for fd in fds:os.close(fd)
            return {'uid':os.geteuid(),'error':'invalid_transfer'}
        fd=fds[0]
        try:
            before=os.pread(fd,16,0)
            try:
                os.pwrite(fd,b'FORGED!',0)
                outcome='ALLOWED'
            except OSError:outcome='DENIED'
            return {'uid':os.geteuid(),'delegated_read':before.startswith(b'SQLite format 3'),
                    'delegated_write':outcome}
        finally:os.close(fd)
    except BaseException as exc:return {'uid':os.geteuid(),'error':type(exc).__name__}

def spawn(user,role,channel,other,fixture,writable):
    r,w=os.pipe();pid=os.fork()
    if pid==0:
        os.close(r);other.close()
        report=child(user,role,channel,fixture,writable)
        os.write(w,json.dumps(report).encode());os.close(w);channel.close();os._exit(0)
    os.close(w);return pid,r

def run(users):
    results={}
    with tempfile.TemporaryDirectory(prefix='ge04-replay-fd-') as tmp:
        root=Path(tmp);root.chmod(0o711)
        private=root/'issuer';private.mkdir(mode=0o700)
        os.chown(private,users['issuer'].pw_uid,users['issuer'].pw_gid)
        for writable in (False,True):
            mode='writable' if writable else 'readonly'
            fixture=private/(mode+'.sqlite')
            with sqlite3.connect(fixture) as db:
                db.execute('CREATE TABLE observations (issuer TEXT PRIMARY KEY)')
                db.execute("INSERT INTO observations VALUES ('synthetic')")
            os.chown(fixture,users['issuer'].pw_uid,users['issuer'].pw_gid);fixture.chmod(0o600)
            before=hashlib.sha256(fixture.read_bytes()).hexdigest()
            a,b=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
            try:
                attacker=spawn(users['attacker'],'attacker',b,a,fixture,writable)
                issuer=spawn(users['issuer'],'issuer',a,b,fixture,writable)
            finally:a.close();b.close()
            reports={}
            for role,(pid,pipe) in (('attacker',attacker),('issuer',issuer)):
                data=os.read(pipe,4096);os.close(pipe)
                _,status=os.waitpid(pid,0)
                reports[role]=json.loads(data) if data and os.waitstatus_to_exitcode(status)==0 else {'error':'child_failed'}
            reports['fixture_modified']=before!=hashlib.sha256(fixture.read_bytes()).hexdigest()
            results[mode]=reports
    observed=(results['readonly']['attacker'].get('delegated_read') is True
              and results['readonly']['attacker'].get('delegated_write')=='DENIED'
              and results['readonly']['fixture_modified'] is False
              and results['writable']['attacker'].get('delegated_read') is True
              and results['writable']['attacker'].get('delegated_write')=='ALLOWED'
              and results['writable']['fixture_modified'] is True)
    return {**BASE,'uids':{k:u.pw_uid for k,u in users.items()},'results':results,
            'delegated_descriptor_risk_observed':observed,
            'limits':'synthetic_SQLite_file_header_corruption_only_not_SQL_mutation_or_production_leak'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--isolated-test',action='store_true')
    p.add_argument('--issuer',required=True);p.add_argument('--attacker',required=True)
    args=p.parse_args()
    if not args.isolated_test or sys.platform!='linux' or os.geteuid()!=0:
        print(json.dumps({**BASE,'reason':'operator root and isolated-test required'}));return 78
    try:
        users={role:pwd.getpwnam(getattr(args,role)) for role in ('issuer','attacker')}
        if users['issuer'].pw_uid==users['attacker'].pw_uid or any(u.pw_uid==0 for u in users.values()):
            raise ValueError('distinct nonroot accounts required')
        print(json.dumps(run(users),sort_keys=True))
    except (OSError,ValueError,sqlite3.Error) as exc:
        print(json.dumps({**BASE,'reason':type(exc).__name__,'detail':str(exc)[:160]}))
    return 78
if __name__=='__main__':raise SystemExit(main())
