#!/usr/bin/env python3
"""Evidence-only historical 63 to current source candidates; no semantic approval."""
import ast,difflib,hashlib,json,subprocess,sys,collections
from pathlib import Path
if not __debug__:
    raise SystemExit("GE-04 evidence check refuses optimized Python: assertions are required")
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
old=json.loads((D/'ge04-a03-original-63-identities.json').read_text());queue=json.loads((D/'ge04-a03-02-gimple-reconciliation.json').read_text());ledger=json.loads((D/'ge04-a03-02-operation-ledger.json').read_text())
queue_idx={(x['file'],x['line']):x for x in queue['authority_crosswalk']};ledger_idx={x['file']:x for x in ledger['entries']}
files={};rows=[];counts=collections.Counter()
for e in old['entries']:
 f=e['file']
 if f not in files:
  p=B/f;raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{f}'],cwd=R,check=True,capture_output=True).stdout
  files[f]=(raw.decode().splitlines(),hashlib.sha256(raw).hexdigest())
 lines,sha=files[f];normalized=e['historical_source'].strip();exact=[i for i,line in enumerate(lines,1) if line.strip()==normalized]
 if len(exact)==1:kind='UNIQUE_EXACT_LINE';candidates=exact
 elif len(exact)>1:kind='AMBIGUOUS_EXACT_LINE';candidates=exact
 else:
  matches=difflib.get_close_matches(normalized,[x.strip() for x in lines],n=3,cutoff=.72)
  candidates=sorted({i for i,line in enumerate(lines,1) if line.strip() in matches});kind='FUZZY_SUGGESTION_ONLY' if candidates else 'NO_SOURCE_MATCH'
 counts[kind]+=1
 rows.append({'file':f,'historical_line':e['line'],'historical_source':normalized,'historical_line_sha256':e['line_sha256'],'reviewed_source_sha256':sha,'source_match_kind':kind,'current_candidate_lines':candidates,'current_line_text':[lines[i-1].strip() for i in candidates],'c_authority_queue_matches':[{'line':i,'apis':queue_idx[(f,i)]['apis']} for i in candidates if (f,i) in queue_idx],'python_ast_call_matches':[{'line':i,'calls':[x['callee'] for x in ledger_idx[f]['call_sites'] if x['line']==i]} for i in candidates if f.endswith('.py')],'semantic_effect_status':'PENDING_MANUAL_VERIFICATION','security_verdict':'PENDING'})
assert len(rows)==63 and sum(counts.values())==63
report={'scope':'A03-02 63 historical omissions to reviewed current source-line candidate crosswalk','historical_revision':old['historical_revision'],'reviewed_revision':REV,'entries':rows,'match_counts':dict(sorted(counts.items())),'total':63,'semantic_mapping_approved':0,'status':'SOURCE_CANDIDATES_ONLY_SEMANTIC_EFFECT_MAPPING_OPEN','limitations':['Exact source text equality does not establish equivalent runtime authority effects','Fuzzy suggestions are not mappings or evidence of effect equivalence','Preprocessor directives, docstrings, signatures and function calls require distinct semantic analysis','Current source locations may be duplicated, moved, changed or deleted','All 63 effect dispositions remain pending independent review'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-historical-current-map.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Historical/current map drift'
print('A03-02 historical current source candidates:',dict(counts),'semantic approvals 0')
