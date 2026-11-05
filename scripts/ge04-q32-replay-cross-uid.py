#!/usr/bin/env python3
"""Operator-root disposable replay-ledger custody probe; deny-only, no authority."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import tempfile

ROLES=('issuer','supervisor','coordinator','attacker')
BASE={'gate':'GE04_Q32_REPLAY_CROSS_UID','disposition':'HOLD',
      'qualified_independent_issuance':False,'real_effects_performed':0}
CHILD='''import json,os,sqlite3,sys
from pathlib import Path
path=Path(sys.argv[1]);directory=path.parent;out={}
def attempt(name,fn):
 try:fn();out[name]='ALLOWED'
 except PermissionError:out[name]='DENIED'
 except OSError as exc:out[name]='ERROR_'+str(exc.errno)
attempt('read',lambda:path.read_bytes())
attempt('write',lambda:path.write_bytes(b'FORGED'))
attempt('replace',lambda:(directory/'replacement').replace(path))
attempt('unlink',lambda:path.unlink())
attempt('link',lambda:os.link(path,directory/'link'))
attempt('traverse',lambda:list(directory.iterdir()))
def sql():
 with sqlite3.connect(path,timeout=.1) as db:db.execute("DELETE FROM observations")
try:sql();out['sql_delete']='ALLOWED'
except sqlite3.Error:out['sql_delete']='DENIED'
out['uid']=os.geteuid();print(json.dumps(out))
'''

def drop(user):
 def run():
  os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
 return run

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--isolated-test',action='store_true')
 for role in ROLES:p.add_argument('--'+role,required=True)
 args=p.parse_args()
 if not args.isolated_test or sys.platform!='linux' or os.geteuid()!=0:
  print(json.dumps({**BASE,'reason':'operator root and isolated-test required'}));return 78
 try:
  users={r:pwd.getpwnam(getattr(args,r)) for r in ROLES}
  if len({u.pw_uid for u in users.values()})!=4 or any(u.pw_uid==0 for u in users.values()):
   raise ValueError('four distinct nonroot accounts required')
  with tempfile.TemporaryDirectory(prefix='ge04-replay-custody-') as tmp:
   root=Path(tmp);root.chmod(0o711)
   private=root/'issuer';private.mkdir(mode=0o700)
   os.chown(private,users['issuer'].pw_uid,users['issuer'].pw_gid)
   path=private/'ledger.sqlite'
   import importlib.util
   modpath=Path(__file__).with_name('ge04-q32-deny-replay-ledger.py')
   spec=importlib.util.spec_from_file_location('replay',modpath)
   module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   module.initialize(path)
   module.observe(path,{'issuer':'synthetic','attempt':'a','generation':'1','nonce':'n'})
   # Close all handles and checkpoint WAL before hashing the sealed fixture.
   import sqlite3
   with sqlite3.connect(path) as db:db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
   os.chown(path,users['issuer'].pw_uid,users['issuer'].pw_gid);path.chmod(0o600)
   before=hashlib.sha256(path.read_bytes()).hexdigest()
   results={}
   for role in ('supervisor','coordinator','attacker'):
    proc=subprocess.run([sys.executable,'-B','-c',CHILD,str(path)],preexec_fn=drop(users[role]),capture_output=True,text=True,timeout=8)
    results[role]=json.loads(proc.stdout) if proc.returncode==0 else {'error':proc.stderr[:150]}
   denied=all(all(results[r].get(k)=='DENIED' for k in ('read','write','replace','unlink','link','traverse','sql_delete')) for r in results)
   unchanged=before==hashlib.sha256(path.read_bytes()).hexdigest() and not (private/'link').exists()
   print(json.dumps({**BASE,'uids':{r:u.pw_uid for r,u in users.items()},'results':results,'negative_operations_denied':denied,'fixture_unchanged':unchanged,'limits':'synthetic_file_DAC_only_no_delegated_fd_or_mount_acl_namespace_proof'},sort_keys=True))
 except (OSError,ValueError,subprocess.SubprocessError,sqlite3.Error) as exc:
  print(json.dumps({**BASE,'reason':type(exc).__name__,'detail':str(exc)[:160]}))
 return 78
if __name__=='__main__':raise SystemExit(main())
