#!/usr/bin/env python3
"""M2.9 coverage reconciliation across historical 53 and current 54 C/Python units.

Candidate-source coverage, NOT a complete semantic call graph or security verdict.
"""
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=root/'native/ge04';docs=root/'docs/security'
source=(docs/'ge04-b1a-source-authority-review-matrix.md').read_text().split('## Sensitive-site inventory',1)[0]
historical=set(re.findall(r'^\| `([^`]+\.(?:c|py))` \|',source,re.M))
assert len(historical)==53,len(historical)
current={p.name for p in base.iterdir() if p.is_file() and p.suffix in ('.c','.py')}
assert historical<=current,(historical-current)
assert len(current)==54,len(current)
extra=sorted(current-historical)
assert extra==['unprivileged_observer.py'],extra
artifacts={
 'sensitive_lexical':'ge04-b1a-sensitive-site-context.json',
 'c_syntax':'ge04-b1a-c-sensitive-disposition.json',
 'c_authority':'ge04-b1a-c-authority-review-queue.json',
 'c_lowered':'ge04-b1a-c-compiler-call-inventory.json',
 'python_ast':'ge04-b1a-python-ast-call-inventory.json',
 'python_imports':'ge04-b1a-python-cross-module-candidates.json',
 'python_api':'ge04-b1a-python-api-semantic-candidates.json'}
data={k:json.loads((docs/v).read_text()) for k,v in artifacts.items()}
cfiles={n for n in current if n.endswith('.c')};pyfiles=current-cfiles
assert {e['file'] for e in data['c_lowered']['entries']}==cfiles
assert data['c_lowered']['compile_failures']==[]
assert data['python_ast']['files']==len(pyfiles)
assert {e['file'] for e in data['python_ast']['entries']}<=pyfiles
assert {e['file'] for e in data['sensitive_lexical']['entries']}<=current
assert {e['file'] for e in data['c_syntax']['entries']}<=cfiles
assert {e['file'] for e in data['c_authority']['entries']}<=cfiles
assert {e['source'] for e in data['python_imports']['entries']}<=pyfiles
assert {e['file'] for e in data['python_api']['entries']}<=pyfiles
csyntax={(e['file'],e['line']) for e in data['c_syntax']['entries']}
lexical_c={(e['file'],e['line']) for e in data['sensitive_lexical']['entries'] if e['file'] in cfiles}
assert csyntax==lexical_c,(csyntax^lexical_c)
lexical_py={(e['file'],e['line']) for e in data['sensitive_lexical']['entries'] if e['file'] in pyfiles}
pyapi={(e['file'],e['line']) for e in data['python_api']['entries']}
assert lexical_py<=pyapi,(lexical_py-pyapi)
authority={(e['file'],e['line']) for e in data['c_authority']['entries']}
assert authority<=csyntax
rows=[]
for name in sorted(current):
 kind='C' if name in cfiles else 'Python'
 c=data['c_lowered']['entries'] if kind=='C' else data['python_ast']['entries']
 allcalls=sum(e['file']==name for e in c) if kind=='Python' else len(next(e['lowered_call_name_candidates'] for e in c if e['file']==name))
 rows.append({'file':name,'kind':kind,'in_historical_matrix':name in historical,
 'compiler_name_candidates_or_ast_calls':allcalls,
 'sensitive_lexical_sites':sum(e['file']==name for e in data['sensitive_lexical']['entries']),
 'c_authority_queue_sites':sum(e['file']==name for e in data['c_authority']['entries']),
 'python_direct_import_call_candidates':sum(e['source']==name for e in data['python_imports']['entries']),
 'semantic_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.9 BIDIRECTIONAL INVENTORY COVERAGE',
 'historical_matrix_units':len(historical),'current_units':len(current),
 'current_extra_units':extra,'per_file':rows,
 'reconciled':{'c_lexical_to_syntax_both_directions':len(csyntax),
 'c_authority_queue_subset':len(authority),
 'python_lexical_to_ast_api_candidates':len(lexical_py),
 'python_ast_calls':len(data['python_ast']['entries']),
 'python_imported_call_candidates':len(data['python_imports']['entries']),
 'c_lowered_name_candidates':sum(e['compiler_name_candidates_or_ast_calls'] for e in rows if e['kind']=='C')},
 'unresolved':['This is artifact-to-artifact coverage, not bidirectional semantic completeness across every callsite.','C compiler lowered-name candidates have no source-level callsite provenance or indirect dispatch resolution.','Python AST and import candidates do not resolve dynamic imports, attribute aliases, decorators, monkeypatching or runtime targets.','Function-pointer, macro, wrapper, multiline and noncall authority reference coverage remains independently unproven.','Every translation unit needs reviewed per-file API allowlist and human site verdicts.'],
 'security_hold':'ACTIVE','independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=docs/'ge04-b1a-bidirectional-semantic-inventory.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'M2.9 inventory drift'
print(f'M2.9: {len(historical)} historical, {len(current)} current C/Python units; {len(csyntax)} C lexical/syntax pairs; {len(lexical_py)} Python lexical/API pairs; semantic closure pending')
