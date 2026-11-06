#!/usr/bin/env python3
"""Synthetic SQLite WAL transaction kill-point probe; no authority or effects."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile

LEDGER = Path(__file__).with_name('ge04-q32-deny-replay-ledger.py')
BASE = {'gate':'GE04_Q32_REPLAY_CRASH', 'disposition':'HOLD',
        'authorized':False, 'qualified_independent_issuance':False,
        'real_effects_performed':0}
BINDING = {'issuer':'synthetic','attempt':'attempt','generation':'1','nonce':'nonce'}
WORKER = '''import sqlite3,sys
path,point=sys.argv[1:]
db=sqlite3.connect(path,isolation_level=None)
db.execute('PRAGMA synchronous=FULL')
db.execute('BEGIN IMMEDIATE')
if point=='before_insert':
 print('READY',flush=True);sys.stdin.buffer.read(1)
db.execute('INSERT INTO observations VALUES (?,?,?,?)',('synthetic','attempt','1','nonce'))
if point=='before_commit':
 print('READY',flush=True);sys.stdin.buffer.read(1)
db.execute('COMMIT')
if point=='after_commit':
 print('READY',flush=True);sys.stdin.buffer.read(1)
'''

def run_probe():
    spec=importlib.util.spec_from_file_location('replay_ledger',LEDGER)
    ledger=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ledger)
    cases={}
    with tempfile.TemporaryDirectory(prefix='ge04-replay-crash-') as tmp:
        for point in ('before_insert','before_commit','after_commit'):
            path=Path(tmp)/(point+'.sqlite')
            ledger.initialize(path)
            proc=subprocess.Popen([sys.executable,'-B','-c',WORKER,str(path),point],
                                  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                ready=proc.stdout.readline().strip()
                if ready!='READY':
                    raise RuntimeError('worker failed to reach checkpoint')
                os.kill(proc.pid,signal.SIGKILL)
                proc.wait(timeout=5)
                result=ledger.observe(path,BINDING)
                expected='REPLAY_DENIED' if point=='after_commit' else 'FIRST_OBSERVATION_DENIED'
                cases[point]={'worker_exit':proc.returncode,'reason':result['reason'],
                              'pass':proc.returncode==-signal.SIGKILL and result['reason']==expected and
                                     result['authorized'] is False and result['real_effects_performed']==0}
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
                proc.stdin.close();proc.stdout.close();proc.stderr.close()
    return {**BASE,'cases':cases,'all_denied_and_recovered':all(x['pass'] for x in cases.values())}

def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument('--isolated-test',action='store_true')
    args=p.parse_args()
    if not args.isolated_test or sys.platform!='linux' or os.geteuid()==0:
        print(json.dumps({**BASE,'reason':'nonroot Linux isolated-test required'}))
        return 78
    try:print(json.dumps(run_probe(),sort_keys=True))
    except (OSError,sqlite3.Error,RuntimeError,subprocess.TimeoutExpired) as exc:
        print(json.dumps({**BASE,'reason':type(exc).__name__}))
    return 78
if __name__=='__main__':raise SystemExit(main())
