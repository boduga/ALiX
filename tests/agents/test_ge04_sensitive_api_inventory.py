"""A.03 source/API candidate inventory drift gate; never executes privileged code."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'native/ge04'
INVENTORY = ROOT / 'docs/security/ge04-b1a-sensitive-api-review-inventory.json'

class SensitiveAPIInventory(unittest.TestCase):
    def test_candidate_callsites_match_inventory_bidirectionally(self):
        data = json.loads(INVENTORY.read_text())
        apis = data['api_allowlist']
        self.assertEqual(len(apis), len(set(apis)))
        pattern = re.compile(r'(?<![A-Za-z0-9_])(?:' + '|'.join(map(re.escape, apis)) + r')(?![A-Za-z0-9_])')
        found = []
        for source in sorted(BASE.iterdir()):
            if source.suffix not in ('.c', '.py'):
                continue
            for number, line in enumerate(source.read_text().splitlines(), 1):
                stripped = line.strip()
                if not stripped or stripped.startswith(('#', '//', '*', '/*')):
                    continue
                matches = sorted(set(pattern.findall(line)))
                if matches:
                    found.append(dict(file=source.name, line=number,
                                      apis=matches, source=stripped, verdict='UNREVIEWED'))
        by_file = {}
        for entry in found:
            by_file.setdefault(entry['file'], set()).update(entry['apis'])
        expected = {name: sorted(names) for name, names in sorted(by_file.items())}
        self.assertEqual(data['per_file_api_allowlist'], expected,
                         'Per-file API allowlist changed; require author reconciliation')
        self.assertEqual(data['review_state'],
                         'AUTHOR_CANDIDATES_ONLY_HUMAN_REVIEW_REQUIRED')
        self.assertEqual(data['entries'], found,
                         'Sensitive API candidate sites changed: regenerate and review inventory')
        self.assertTrue(all(x['verdict'] == 'UNREVIEWED' for x in found),
                        'Do not imply human review without independent signoff')

    def test_required_high_risk_apis_are_in_scope(self):
        data = json.loads(INVENTORY.read_text())
        self.assertTrue({'Subscribe', 'Unsubscribe', 'SCM_RIGHTS', 'setresuid',
                         'unlinkat', 'flock', 'accept4', 'memfd_create',
                         'pread', 'clone3', 'SYS_clone3', '_mount', 'mkdirat'} <= set(data['api_allowlist']))

class SensitiveAPIReviewQueue(unittest.TestCase):
    def test_every_candidate_has_pending_review_and_category(self):
        inventory = json.loads(INVENTORY.read_text())
        queue = json.loads((ROOT / 'docs/security/ge04-b1a-sensitive-api-triage.json').read_text())
        categories = queue['categories']
        self.assertEqual(set(inventory['api_allowlist']),
                         {api for names in categories.values() for api in names})
        self.assertEqual(len(queue['entries']), len(inventory['entries']))
        for source, item in zip(inventory['entries'], queue['entries']):
            self.assertEqual((source['file'], source['line'], source['apis']),
                             (item['file'], item['line'], item['apis']))
            expected = sorted(group for group, names in categories.items()
                              if set(source['apis']) & set(names))
            self.assertEqual(item['review_categories'], expected)
            self.assertEqual(item['review_checks'], sorted({check for group in expected
                for check in queue['required_checks'][group]}))
            self.assertEqual(item['security_verdict'],
                             'PENDING_INDEPENDENT_HUMAN_REVIEW')

class HistoricalBroadOmissionCandidates(unittest.TestCase):
    def test_broad_historical_candidates_are_source_grounded(self):
        """Validate recorded historical line identities; no claim of reviewer-scan equivalence."""
        import subprocess
        report = json.loads((ROOT / 'docs/security/ge04-b1a-broad-omission-candidates.json').read_text())
        matrix = (ROOT / 'docs/security/ge04-b1a-source-authority-review-matrix.md').read_text()
        sections = re.split(r'^### `([^`]+)`\s*$', matrix, flags=re.M)
        indexed = {sections[i]: {int(n) for n in re.findall(r'^- L(\d+):', sections[i+1], re.M)}
                   for i in range(1, len(sections), 2)}
        terms = report['terms']
        token = re.compile(r'(?<![A-Za-z0-9_])(?:' + '|'.join(map(re.escape, sorted(terms, key=len, reverse=True))) + r')(?![A-Za-z0-9_])')
        expected = []
        historical = subprocess.run(['git', 'ls-tree', '--name-only', 'd6e22669', 'native/ge04/'],
                                    cwd=ROOT, capture_output=True, text=True, check=True)
        # Historical inventory must not assume new working-tree files existed in the pinned revision.
        historical_files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', 'd6e22669', 'native/ge04/'],
                                          cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
        for name in historical_files:
            path = Path(name)
            if path.suffix not in ('.c', '.py') or path.parent.as_posix() != 'native/ge04':
                continue
            result = subprocess.run(['git', 'show', 'd6e22669:' + name],
                                    cwd=ROOT, capture_output=True, text=True, check=True)
            for line_no, line in enumerate(result.stdout.splitlines(), 1):
                stripped = line.strip()
                if not stripped or stripped.startswith(('#', '//', '*', '/*')):
                    continue
                apis = sorted(set(token.findall(line)))
                if apis and line_no not in indexed.get(path.name, set()):
                    expected.append({'file': path.name, 'line': line_no,
                                     'apis': apis, 'source': stripped,
                                     'status': 'CANDIDATE_NOT_ADJUDICATED'})
        self.assertEqual(report['baseline_candidates_not_in_matrix'], expected)

class HistoricalOmissionTriage(unittest.TestCase):
    def test_all_broad_candidates_preserved_and_pending_review(self):
        original = json.loads((ROOT / 'docs/security/ge04-b1a-broad-omission-candidates.json').read_text())
        triage = json.loads((ROOT / 'docs/security/ge04-b1a-broad-omission-triage.json').read_text())
        self.assertEqual(triage['source_revision'], 'd6e22669')
        self.assertEqual(triage['classification'], 'AUTHOR_SYNTAX_TRIAGE_NOT_SEMANTIC_SECURITY_REVIEW')
        self.assertEqual(len(triage['entries']), len(original['baseline_candidates_not_in_matrix']))
        allowed = {'DIRECT_CALL_CANDIDATE', 'AUTHORITY_REFERENCE_CANDIDATE',
                   'LIKELY_NONEXECUTING_LEXICAL_MATCH', 'GENERAL_API_OR_AMBIGUOUS_REFERENCE',
                   'PYTHON_AST_DIRECT_CALL', 'PYTHON_AST_CALL_AMBIGUOUS_AUTHORITY',
                   'PYTHON_AST_NONCALL_OR_WRAPPER'}
        for before, after in zip(original['baseline_candidates_not_in_matrix'], triage['entries']):
            self.assertEqual({key: after[key] for key in before}, before)
            self.assertIn(after['triage'], allowed)
            self.assertEqual(after['review_verdict'], 'PENDING_HUMAN_SECURITY_REVIEW')
        selected = {(e['file'], e['line'], api) for e in triage['entries']
                    for api in e['direct_api_candidates']}
        self.assertTrue({('systemd_job_signal_observer.py', 106, 'Subscribe'),
                         ('systemd_job_signal_observer.py', 137, 'Unsubscribe'),
                         ('cgroup-worker-qualification.c', 305, 'unlinkat'),
                         ('worker-stream.c', 170, 'accept4')} <= selected)

    def test_python_ast_call_evidence_is_reproducible(self):
        import ast
        import subprocess
        from collections import defaultdict
        triage = json.loads((ROOT / 'docs/security/ge04-b1a-broad-omission-triage.json').read_text())
        cache = {}
        for entry in triage['entries']:
            if not entry['file'].endswith('.py'):
                continue
            file = entry['file']
            if file not in cache:
                raw = subprocess.run(['git', 'show', 'd6e22669:native/ge04/' + file],
                                     cwd=ROOT, capture_output=True, text=True, check=True).stdout
                by_line = defaultdict(list)
                for node in ast.walk(ast.parse(raw, filename=file)):
                    if not isinstance(node, ast.Call):
                        continue
                    name = (node.func.attr if isinstance(node.func, ast.Attribute)
                            else node.func.id if isinstance(node.func, ast.Name) else None)
                    if name:
                        by_line[node.lineno].append((name, ast.unparse(node.func)))
                cache[file] = by_line
            matching = cache[file].get(entry['line'], [])
            expected_names = sorted(set(name for name, _ in matching if name in entry['apis']))
            expected_callees = sorted(set(callee for name, callee in matching if name in entry['apis']))
            self.assertEqual(entry['python_ast_calls'], expected_names)
            self.assertEqual(entry['python_ast_callees'], expected_callees)

class HistoricalCCallSyntax(unittest.TestCase):
    def test_c_invocation_candidates_match_pinned_source(self):
        import subprocess
        triage = json.loads((ROOT / 'docs/security/ge04-b1a-broad-omission-triage.json').read_text())
        files = {}
        seen = 0
        for entry in triage['entries']:
            if entry['triage'] != 'DIRECT_CALL_CANDIDATE' or not entry['file'].endswith('.c'):
                continue
            name = entry['file']
            if name not in files:
                files[name] = subprocess.run(
                    ['git', 'show', 'd6e22669:native/ge04/' + name], cwd=ROOT,
                    capture_output=True, text=True, check=True).stdout.splitlines()
            lines = files[name]
            line = lines[entry['line'] - 1]
            expected = {api: bool(re.search(r'(?<![A-Za-z0-9_])' + re.escape(api) + r'\s*\(', line))
                        for api in entry['direct_api_candidates']}
            self.assertTrue(expected and all(expected.values()))
            self.assertEqual(entry['c_invocation_syntax'], expected)
            self.assertEqual(entry['c_semantic_context'], {
                'previous_line': lines[entry['line'] - 2].strip() if entry['line'] > 1 else '',
                'next_line': lines[entry['line']].strip() if entry['line'] < len(lines) else ''})
            self.assertEqual(entry['c_authority_effect'], 'NOT_ADJUDICATED')
            seen += 1
        self.assertEqual(seen, 64)
