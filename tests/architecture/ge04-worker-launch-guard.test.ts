/** Structural guard for the canonical facade, not a whole-program launch proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function launchBypasses(source: string): string[] {
  const violations: string[] = [];
  // Include literal references in ESM imports, re-exports, dynamic imports,
  // require and process.getBuiltinModule. Nonliteral loading is forbidden too.
  if (/["'](?:node:)?(?:child_process|worker_threads)["']/.test(source)) violations.push('direct process/worker dependency');
  if (/\bprocess\s*(?:\.\s*kill|\[\s*["']kill["']\s*\])\s*\(/.test(source)) violations.push('direct process signalling');
  if (/\b(?:eval|Function)\s*\(|\bgetBuiltinModule\s*\(|\brequire\s*\(|\bimport\s*\(/.test(source)) violations.push('dynamic execution/loading requires boundary review');
  return violations;
}
test('manager and task contract have no direct process launch, signalling or dynamic loader', () => {
  for (const file of ['src/agents/subagent-manager.ts', 'src/agents/worker-task-supervisor.ts']) {
    assert.deepEqual(launchBypasses(readFileSync(resolve(root, file), 'utf8')), [], file);
  }
});
test('guard rejects aliased, dynamic, CommonJS, re-export and builtin-module bypass fixtures', () => {
  for (const source of [
    'import {spawn as launch} from "node:child_process";',
    'const cp = await import("child_process");',
    'const cp = require("node:child_process");',
    'export {spawn} from "child_process";',
    'const cp = process.getBuiltinModule("child_process");',
    'new Worker("worker.js"); import {Worker} from "node:worker_threads";',
    'process.kill(-pid);', 'process["kill"](-pid);',
    'const cp = await import(moduleName);', 'eval(dynamicCode);',
  ]) assert.ok(launchBypasses(source).length > 0, source);
  assert.deepEqual(launchBypasses('await supervisor.launch(request); await handle.cancel("cancelled");'), []);
});
