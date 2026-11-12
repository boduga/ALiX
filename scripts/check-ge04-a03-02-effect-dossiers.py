#!/usr/bin/env python3
"""Source-pinned, per-site effect dossiers with explicit verification boundaries."""
import json,hashlib,subprocess,sys,collections
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'docs/security';B=R/'native/ge04';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def load(s):return json.loads((D/('ge04-a03-02-'+s+'.json')).read_text())
h=load('historical-current-map');g=load('six-stage-gates');a=load('authority-completeness');nc=load('noncall-authority')
source={}
def lines(name):
 if name not in source:
  raw=(B/name).read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{name}'],cwd=R,check=True,capture_output=True).stdout
  source[name]=raw.decode().splitlines()
 return source[name]
noncall={(x['file'],x['reference_line']):x for x in nc['entries']}
classifications={'accept4':('SOCKET_ACCEPT','Review peer identity, socket permissions and accepted descriptor lifetime'),'SCM_RIGHTS':('DESCRIPTOR_TRANSFER','Review ancillary-data validation, descriptor ownership and rejection closure'),'CLONE_INTO_CGROUP':('PROCESS_CGROUP_BIRTH','Review cgroup binding and clone3 argument/child identity'),'syscall':('RAW_SYSCALL','Resolve syscall number and all argument-dependent effects'),'mount':('MOUNT_MUTATION','Review namespace, mount target, propagation and privileges'),'unlinkat':('FILESYSTEM_DELETION','Review directory fd, inode identity, races and authorization'),'mkdirat':('FILESYSTEM_CREATION','Review parent directory identity, mode and cleanup'),'waitpid':('PROCESS_REAP','Review child ownership, PID reuse and wait state'),'flock':('LOCKING','Review lock lifetime and writer exclusion'),'setresuid':('IDENTITY_CHANGE','Review permanent privilege drop and error handling'),'setresgid':('IDENTITY_CHANGE','Review permanent privilege drop and error handling'),'execveat':('PROCESS_EXECUTION','Review executable descriptor, environment and inherited descriptors'),'pread':('DESCRIPTOR_READ','Review descriptor provenance and bounded reads'),'write':('DESCRIPTOR_WRITE','Review descriptor provenance, bounded writes and durability')}
def category(apis):
 for api in apis:
  if api in classifications:return classifications[api]
 return ('UNCLASSIFIED_AUTHORITY_CANDIDATE','Resolve actual effect, permissions and failure paths')
rows=[]
for x in g['c_authority_site_effect_candidates']:
 f=x['file'];line=x['line'];content=lines(f);assert 1<=line<=len(content)
 effect=noncall.get((f,line));kind,question=category(x['apis']);target_line=effect['effect_line'] if effect else line
 rows.append({'file':f,'line':line,'source':content[line-1].strip(),'source_sha256':hashlib.sha256((B/f).read_bytes()).hexdigest(),'apis':x['apis'],'compiler_targets':x['compiler_call_targets'],'effect_line':target_line,'effect_source':content[target_line-1].strip(),'effect_hypothesis':kind,'required_review':question,'effect_identity_verified':bool(x['compiler_call_targets'] or effect),'authorization_verified':False,'race_and_lifetime_verified':False,'failure_path_verified':False,'security_disposition':'PENDING'})
assert len(rows)==50 and all(x['effect_identity_verified'] for x in rows)
byline={(x['file'],x['line']):x for x in rows};historical=[]
for x in h['entries']:
 assert x['source_match_kind']=='UNIQUE_EXACT_LINE';f=x['file'];line=x['current_candidate_lines'][0];content=lines(f)
 hits=[r for r in rows if r['file']==f and abs(r['line']-line)<=2]
 historical.append({'file':f,'historical_line':x['historical_line'],'current_line':line,'source':content[line-1].strip(),'source_sha256':x['reviewed_source_sha256'],'nearby_c_authority_sites':[r['line'] for r in hits],'source_line_is_direct_c_authority_site':(f,line) in byline,'runtime_semantics_verified':False,'security_disposition':'PENDING'})
assert len(historical)==63
report={'scope':'A03-02 evidence dossiers for 50 C authority sites and 63 historical omissions','reviewed_revision':REV,'c_authority_dossiers':rows,'historical_line_dossiers':historical,'authority_hypothesis_counts':dict(collections.Counter(x['effect_hypothesis'] for x in rows)),'verified_source_matches':63,'compiler_or_noncall_effect_identity_candidates':50,'security_dispositions_approved':0,'status':'EVIDENCE_PREPARED_NOT_SEMANTIC_OR_SECURITY_APPROVAL','limitations':['API classifications are review hypotheses, not demonstrated security properties','Nearby source location is not proof of transitive effects','Runtime identity, authorization, race, failure and revocation must be verified separately','No privileged runtime tests were executed; security hold remains active'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-effect-dossiers.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Effect dossiers drift'
print('Effect dossiers:',len(rows),'C authority sites;',len(historical),'historical source sites; zero security approvals')
