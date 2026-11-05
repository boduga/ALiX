"""Scratch-only real ALiX flock syscall trace; prints counts, never raw traces."""
import json, os, pathlib, shutil, subprocess, sys, tempfile
BASE={'gate':'GE04_Q32_LOCK_SYSCALL_TRACE','disposition':'HOLD','qualified_independent_issuance':False,'real_effects_performed':0}
def main():
 if len(sys.argv)!=2 or sys.argv[1]!='--isolated-test' or sys.platform!='linux' or os.geteuid()==0 or not shutil.which('strace'):
  print(json.dumps({**BASE,'reason':'nonroot Linux strace and --isolated-test required'}));return 78
 script=pathlib.Path(__file__).with_name('ge04-q32-real-lock-fd-probe.mjs')
 with tempfile.TemporaryDirectory(prefix='ge04-strace-') as td:
  prefix=str(pathlib.Path(td)/'trace')
  p=subprocess.run(['strace','-ff','-qq','-e','trace=dup2,dup3,close,fcntl,execve','-o',prefix,'node',str(script),'--isolated-test'],capture_output=True,text=True,timeout=20)
  try: result=json.loads(p.stdout)
  except json.JSONDecodeError: result={}
  lines=[]
  for f in pathlib.Path(td).glob('trace.*'):
   lines.extend(f.read_text(errors='replace').splitlines())
  # Do not print raw execve arguments, environment, file paths, or syscall lines.
  import re
  flock_exec=sum(bool(re.match(r'^execve\("(?:/[^"\n]*/)?flock"',x)) for x in lines)
  fd9_dup=sum(bool(re.match(r'^dup[23]\([^\n]*, 9(?:,|\))',x)) for x in lines)
  checks={'lock_probe_passed':result.get('all_expected') is True,'flock_exec_observed':flock_exec>=1,'trace_files_present':bool(lines),'probe_exited_hold':p.returncode==78}
  print(json.dumps({**BASE,'checks':checks,'all_expected':all(checks.values()),'counts':{'flock_exec':flock_exec,'dup_to_fd9':fd9_dup},'limits':'scratch_only_real_ALiX_lock; no proof of full child FD table or subagent credential isolation; dup2 may occur inside posix_spawn implementation'}))
 return 78
if __name__=='__main__':sys.exit(main())
