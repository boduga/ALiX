#!/usr/bin/env python3
"""Analyze Claude session for actual tool failures (exit codes, null args, type errors)."""
import json
from collections import Counter

filepath = '/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/450a14fd-27b7-48fa-a219-bb33910c03a3.jsonl'

calls = {}
actual_failures = Counter()
exit_code_errors = []
null_arg_errors = []
type_errors = []

with open(filepath) as f:
    for line in f:
        try:
            obj = json.loads(line)
            if obj.get('type') == 'assistant':
                for block in obj.get('message', {}).get('content', []):
                    if block.get('type') == 'tool_use':
                        calls[block['id']] = {
                            'name': block['name'],
                            'args': block.get('input', {})
                        }
            elif obj.get('type') == 'user':
                for block in obj.get('message', {}).get('content', []):
                    if block.get('type') == 'tool_result':
                        id = block.get('tool_use_id')
                        content = block.get('content', '')
                        if isinstance(content, list):
                            content = ' '.join(str(c) for c in content)
                        call = calls.get(id, {})
                        tool = call.get('name', 'unknown')
                        args = call.get('args', {})
                        content_str = str(content)

                        is_error = False

                        # Exit code errors
                        if 'Exit code' in content_str:
                            is_error = True
                            for lc in content_str.split('\n'):
                                if lc.startswith('Exit code'):
                                    code = lc.replace('Exit code', '').strip()
                            exit_code_errors.append({
                                'tool': tool, 'code': code,
                                'args': args,
                                'output': content_str[:300]
                            })

                        # Null args
                        for k, v in args.items():
                            if v is None:
                                if not is_error:
                                    is_error = True
                                null_arg_errors.append({
                                    'tool': tool, 'field': k,
                                    'args': args,
                                    'output': content_str[:200]
                                })

                        # Type errors
                        if 'TypeError' in content_str or 'Invalid argument' in content_str:
                            is_error = True
                            type_errors.append({
                                'tool': tool, 'args': args,
                                'error': content_str[:200]
                            })

                        if is_error:
                            actual_failures[tool] += 1
        except:
            pass

print(f'Total actual failures: {sum(actual_failures.values())}')
print()
print('By tool:')
for tool, count in actual_failures.most_common(20):
    print(f'  {tool}: {count}')

print()
print(f'=== Exit Code Errors ({len(exit_code_errors)}) ===')
code_counter = Counter(e['code'] for e in exit_code_errors)
for code, count in code_counter.most_common(10):
    print(f'  Exit code {code}: {count}x')
    samples = [e for e in exit_code_errors if e['code'] == code][:2]
    for s in samples:
        print(f'    Tool: {s["tool"]}, Args: {json.dumps(s["args"], default=str)[:150]}')
        print(f'    Output: {s["output"][:150]}')

print()
print(f'=== Null/Undefined Arg Errors ({len(null_arg_errors)}) ===')
null_field_counts = Counter((e['tool'], e['field']) for e in null_arg_errors)
for (tool, field), count in null_field_counts.most_common(15):
    print(f'  {tool}.{field}: {count}x')
    samples = [e for e in null_arg_errors if e['tool']==tool and e['field']==field][:2]
    for s in samples:
        print(f'    Args: {json.dumps(s["args"], default=str)[:200]}')
        print(f'    Output: {s["output"][:150]}')

print()
print(f'=== Type Errors ({len(type_errors)}) ===')
for t in type_errors[:5]:
    print(f'  Tool: {t["tool"]}')
    print(f'  Args: {json.dumps(t["args"], default=str)[:200]}')
    print(f'  Error: {t["error"][:200]}')
    print()

print(f'Counts: exit_code={len(exit_code_errors)}, null_arg={len(null_arg_errors)}, type_error={len(type_errors)}')
