#!/usr/bin/env python3
"""Pin author-reviewed syntax classifications for Python lexical noncalls."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/security/ge04-b1a-sensitive-site-context.json'
OUTPUT = ROOT / 'docs/security/ge04-b1a-python-noncall-disposition.json'
# Explicit decisions about syntax only; none is a human security verdict.
DECISIONS = {
    ('bootstrap_receiver.py', 3): ('MODULE_DOCSTRING', 'SCM_RIGHTS occurs in a module docstring; not executable at this site.'),
    ('bootstrap_receiver.py', 72): ('AUTHORITY_CONSTANT_COMPARISON', 'socket.SCM_RIGHTS comparison is an active ancillary descriptor-transfer branch; retain in authority review.'),
    ('bounded_phase_observer.py', 4): ('MODULE_DOCSTRING', 'kill appears in module documentation, not a call at this site.'),
    ('exclusive_birth_handoff.py', 41): ('PROTOCOL_VALUE_COMPARISON', 'StartTransientUnit is a string receipt-method equality check, not a bus call at this site.'),
    ('systemd_job_signal_observer.py', 24): ('FUNCTION_DOCSTRING', 'Subscribe appears in observer documentation, not a call at this site.'),
    ('systemd_job_signal_observer.py', 31): ('FUNCTION_DOCSTRING', 'Subscribe appears in observer documentation, not a call at this site.'),
    ('unit_kernel_observer.py', 58): ('FUNCTION_DECLARATION', '_mount is a Python function declaration; calls elsewhere remain separately inventoried.'),
    ('unit_kernel_observer.py', 87): ('FUNCTION_DOCSTRING', 'mount occurs in a function docstring, not a call at this site.'),
}
source = json.loads(SOURCE.read_text())
noncalls = [e for e in source['entries'] if e['file'].endswith('.py') and e['syntax_classification'] == 'REFERENCE_OR_NONCALL']
assert {(e['file'], e['line']) for e in noncalls} == set(DECISIONS), 'Unclassified Python noncall sites'
entries = []
for e in noncalls:
    kind, explanation = DECISIONS[(e['file'], e['line'])]
    entries.append({'file': e['file'], 'line': e['line'], 'apis': e['apis'],
                    'source': e['source'], 'author_syntax_disposition': kind,
                    'reason': explanation, 'security_verdict': 'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report = {'method': 'AUTHOR_SYNTAX_DISPOSITION_NOT_HUMAN_SECURITY_REVIEW', 'entries': entries}
assert json.loads(OUTPUT.read_text()) == report, 'Python noncall disposition drift'
print(f'GE-04 Python: {len(entries)} noncall lexical sites classified; 1 authority-bearing constant branch retained')
