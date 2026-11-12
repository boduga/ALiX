#!/usr/bin/env python3
"""A03-02 source-pinned 365 unresolved C candidates: object-symbol evidence.
No privileged native execution or benign classifications.
"""
import collections,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
local=json.loads((D/'ge04-a03-02-local-wrapper-effects.json').read_text());cross=json.loads((D/'ge04-a03-02-cross-tu-wrapper-effects.json').read_text())
assert local['reviewed_revision']==cross['reviewed_revision']==REV
pending=[x for x in local['entries'] if not x['candidate_sensitive_sinks']];assert len(pending)==365
symbols={};hashes={};defined=collections.defaultdict(list)
with tempfile.TemporaryDirectory(prefix='ge04-a03-c-symbols-') as tmp:
 for src in sorted(B.glob('*.c')):
  raw=src.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{src.name}'],cwd=R,check=True,capture_output=True).stdout
  hashes[src.name]=hashlib.sha256(raw).hexdigest();obj=Path(tmp)/(src.name+'.o')
  subprocess.run(['gcc','-std=gnu11','-O0','-I',str(B),'-c',str(src),'-o',str(obj)],check=True,capture_output=True,text=True)
  output=subprocess.run(['nm','-a',str(obj)],check=True,capture_output=True,text=True).stdout
  entries=[]
  for line in output.splitlines():
   parts=line.split()
   if len(parts)<2:continue
   typ,name=parts[-2:]
   if typ in ('U','T','t','W','w'):entries.append((typ,name))
   if typ in ('T','t','W'):defined[name].append({'file':src.name,'symbol_type':typ})
  symbols[src.name]=entries
rows=[];counts=collections.Counter()
for r in pending:
 file=r['file'];name=r['symbol'];matches=[t for t,s in symbols[file] if s==name];targets=defined.get(name,[])
 if r['definition_line'] is not None:category='LOCAL_SOURCE_DEFINITION_NO_IDENTIFIED_SINK'
 elif any(t in ('T','t','W') for t in matches):category='OBJECT_LOCAL_DEFINITION_LEXICAL_MISS'
 elif 'U' in matches and targets:category='OBJECT_UNDEFINED_WITH_REPOSITORY_DEFINITION'
 elif 'U' in matches:category='OBJECT_UNDEFINED_EXTERNAL_TARGET_UNRESOLVED'
 elif targets:category='REPOSITORY_DEFINITION_WITHOUT_OBJECT_REFERENCE'
 else:category='NO_OBJECT_SYMBOL_MATCH_MACRO_INLINE_OR_ELIDED'
 counts[category]+=1
 rows.append({'file':file,'symbol':name,'source_sha256':hashes[file],'local_source_definition_line':r['definition_line'],'object_symbol_types':sorted(set(matches)),'repository_object_definitions':targets,'category':category,'candidate_sensitive_sinks':[],'security_verdict':'PENDING'})
assert sum(counts.values())==365
report={'scope':'A03-02 compiler object symbol reconciliation for 365 C candidates without identified sensitive sinks','reviewed_revision':REV,'files_compiled':len(symbols),'candidates':365,'category_counts':dict(sorted(counts.items())),'entries':rows,'status':'C_OBJECT_SYMBOL_RECONCILIATION_SEMANTIC_COMPLETENESS_OPEN','limitations':['nm object evidence is not a linked call graph or runtime dispatch proof','No object symbol may mean macro, inline expansion, compiler lowering, or lexical mismatch','External undefined symbols are not automatically libc, safe, or effect-free','A source definition without recognized sensitive sinks is not harmless','All 365 site effects and A03-02 semantic completeness remain pending'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-c-unresolved-symbols.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'C unresolved symbol evidence drift'
print('A03-02 C unresolved:',dict(counts),'OPEN')
