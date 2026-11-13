#!/usr/bin/env python3
"""Fail-closed GE-04 candidate-site CI gate; not semantic security acceptance."""
import json,re,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
base=root/'native/ge04';docs=root/'docs/security'
inv=json.loads((docs/'ge04-b1a-sensitive-api-review-inventory.json').read_text())
terms=inv['api_allowlist']
assert terms and len(terms)==len(set(terms))
pattern=re.compile(r'(?<![A-Za-z0-9_])(?:'+'|'.join(map(re.escape,terms))+r')(?![A-Za-z0-9_])')
def scan(name,source):
 result=[]
 for number,line in enumerate(source.splitlines(),1):
  stripped=line.strip()
  if not stripped or stripped.startswith(('#','//','*','/*')):continue
  matches=sorted(set(pattern.findall(line)))
  if matches:result.append({'file':name,'line':number,'apis':matches,'source':stripped,'verdict':'UNREVIEWED'})
 return result
found=[]
for p in sorted(base.iterdir()):
 if p.suffix in ('.c','.py') and p.is_file():found.extend(scan(p.name,p.read_text()))
assert found==inv['entries'],'Sensitive-site inventory differs from current source; author review required'
# Negative controls ensure the detector catches additions AND edits, not only counts.
for name,probe in [('new-sensitive.c','void x(void){unlinkat(1,"x",0);}\n'),('new-sensitive.py','manager.Subscribe(timeout=1)\n')]:
 assert scan(name,probe),'Candidate scanner failed to detect new sensitive call'
 assert not any(e['file']==name for e in found),'Unexpected fixture collision'
assert scan('new-sensitive.c','void x(void){unlinkat(1,"x",0);}\n')!=scan('new-sensitive.c','void x(void){unlinkat(1,"y",0);}\n'), 'Candidate scanner missed changed sensitive line'
checks=['check-ge04-sensitive-site-context.py','check-ge04-c-sensitive-disposition.py','check-ge04-c-authority-review-queue.py','check-ge04-python-api-semantic-candidates.py','check-ge04-python-authority-ast.py','check-ge04-python-import-calls.py','check-ge04-bidirectional-semantic-inventory.py','check-ge04-tu-api-allowlists.py']
for script in checks:
 subprocess.run([sys.executable,str(root/'scripts'/script)],cwd=root,check=True)
print(f'GE-04 CI candidate-site gate PASS: {len(found)} sensitive lines; {len(checks)} downstream drift checks; injected additions and changes detected; HUMAN REVIEW STILL REQUIRED')
