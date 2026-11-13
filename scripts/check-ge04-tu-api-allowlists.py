#!/usr/bin/env python3
"""M2.10 per-translation-unit candidate API allowlists; no human verdicts fabricated."""
import ast,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=root/'native/ge04';docs=root/'docs/security'
files=sorted(p for p in base.iterdir() if p.suffix in ('.c','.py') and p.is_file())
lex=json.loads((docs/'ge04-b1a-sensitive-site-context.json').read_text())['entries']
cs=json.loads((docs/'ge04-b1a-c-sensitive-disposition.json').read_text())['entries']
ca=json.loads((docs/'ge04-b1a-c-authority-review-queue.json').read_text())['entries']
py=json.loads((docs/'ge04-b1a-python-ast-call-inventory.json').read_text())['entries']
imports=json.loads((docs/'ge04-b1a-python-cross-module-candidates.json').read_text())['entries']
gcc=json.loads((docs/'ge04-b1a-c-compiler-call-inventory.json').read_text())['entries']
assert len(files)==54
entries=[]
for p in files:
 name=p.name;lines=p.read_text().splitlines()
 ls=[e for e in lex if e['file']==name]; authority=[e for e in ca if e['file']==name]
 for e in ls:assert lines[e['line']-1].strip()==e['source']
 for e in authority:assert lines[e['line']-1].strip()==e['source']
 names=sorted({api for e in ls for api in e['apis']})
 sites=[{'line':e['line'],'apis':e['apis'],'source':e['source'],'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'} for e in ls]
 if p.suffix=='.py':
  ast.parse(p.read_text()); call_count=sum(e['file']==name for e in py)
  direct_imports=[{'line':e['line'],'callee':e['callee'],'target':e['target']} for e in imports if e['source']==name]
  compiler_names=[]
 else:
  call_count=None;direct_imports=[]
  compiler_names=next(e['lowered_call_name_candidates'] for e in gcc if e['file']==name)
 entries.append({'file':name,'kind':'C' if p.suffix=='.c' else 'Python',
 'candidate_api_allowlist':names,'candidate_sites':sites,
 'c_authority_site_count':len(authority),'python_ast_call_count':call_count,
 'python_direct_import_calls':direct_imports,
 'c_compiler_lowered_name_candidates':compiler_names,
 'allowlist_status':'AUTHOR_DRAFT_NOT_REVIEWED_OR_COMPLETE',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
assert sum(len(e['candidate_sites']) for e in entries)==len(lex)==109
assert sum(e['c_authority_site_count'] for e in entries)==len(ca)==50
assert sum(e['python_ast_call_count'] or 0 for e in entries)==len(py)==1379
report={'scope':'MEDIUM-2 M2.10 PER-TRANSLATION-UNIT CANDIDATE API ALLOWLISTS',
 'files':len(entries),'entries':entries,
 'limits':['Draft API lists are derived from a global lexical vocabulary, not an independently reviewed complete API universe.','Empty candidate_api_allowlist is NOT evidence that the translation unit lacks authority.','C compiler lowered-name candidates are not source-level verified calls.','Python AST expressions and direct imports do not resolve dynamic/indirect targets.','CI drift checking against the same incomplete source recognizer cannot establish exhaustive semantic coverage.','Human reviewers must adjudicate APIs and every authority site before these become approved allowlists.'],
 'independent_human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW','security_hold':'ACTIVE'}
out=docs/'ge04-b1a-tu-api-allowlists.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'M2.10 per-TU allowlist drift'
print(f'M2.10: {len(entries)} per-TU draft lists; {len(lex)} source sites; {len(ca)} C authority sites; no human approvals')
