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
  if (/["'`](?:node:)?(?:child_process|worker_threads)["'`]/.test(source)) violations.push('direct process/worker dependency');
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

function fixedRefusalFirst(source: string, signature: string): boolean {
  const position = source.indexOf(signature);
  return position >= 0 && source.slice(position + signature.length).trimStart().startsWith('requireTaskWorkerSupervisor(undefined);');
}
function defaultRefusalFirst(source: string): boolean {
  const signature = '): Promise<WorkerExecutionResult> {';
  const position = source.indexOf(signature);
  if (position < 0) return false;
  return /^\s*if\s*\(signal\.aborted\)\s*return\s*\{[^}]*\};\s*try\s*\{\s*requireTaskWorkerSupervisor\(undefined\);\s*\}\s*catch\s*\(error\)\s*\{\s*return\s*\{[\s\S]*?\};\s*\}/.test(source.slice(position + signature.length));
}
test('known legacy worker entries refuse before config, providers or in-process execution', () => {
  const cli = readFileSync(resolve(root, 'src/cli.ts'), 'utf8');
  const worker = readFileSync(resolve(root, 'src/agents/subagent-cli.ts'), 'utf8');
  const executor = readFileSync(resolve(root, 'src/coordination/kernel/worker-executor.ts'), 'utf8');
  assert.ok(fixedRefusalFirst(cli, 'if (command === "agent" && agentRole) {'));
  assert.ok(fixedRefusalFirst(cli, 'if (command === "run" && args.some(arg => arg === "--subagent" || arg.startsWith("--subagent="))) {'));
  assert.ok(fixedRefusalFirst(worker, 'static async main(argv: string[]): Promise<void> {'));
  assert.ok(defaultRefusalFirst(executor));
});
test('entry guard rejects absent, conditional and late refusal fixtures', () => {
  const signature = 'async main() {';
  assert.ok(fixedRefusalFirst('async main() { requireTaskWorkerSupervisor(undefined); legacy(); }', signature));
  for (const source of ['async main() { legacy(); }',
    'async main() { if (flag) requireTaskWorkerSupervisor(undefined); legacy(); }',
    'async main() { legacy(); requireTaskWorkerSupervisor(undefined); }']) assert.equal(fixedRefusalFirst(source, signature), false);
  assert.equal(defaultRefusalFirst('): Promise<WorkerExecutionResult> { await runTask(); try {requireTaskWorkerSupervisor(undefined);} catch (error) {return {};} }'), false);
});

// This conservative source freeze requires explicit review of changed process
// modules. It cannot classify dynamic shell payloads or prove native isolation.
import {readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
function sourceFiles(path: string): string[] {
  return readdirSync(path, {withFileTypes: true}).flatMap(entry => {
    const file = resolve(path, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Source symlink requires boundary review: ${file}`);
    return entry.isDirectory() ? sourceFiles(file) : entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) ? [file] : [];
  });
}
function hasDirectProcessDependency(source: string): boolean {
  return /["'`](?:node:)?(?:child_process|worker_threads)["'`]/.test(source) || /\bgetBuiltinModule\s*\(/.test(source);
}
test('new process dependency modules and changes to existing launch-capable modules require review', () => {
  const baseline = JSON.parse(readFileSync(resolve(root, 'tests/architecture/ge04-process-import-baseline.json'), 'utf8')) as {
    entries: Array<{path: string; sha256: string; classification: string}>;
  };
  const expected = new Map(baseline.entries.map(entry => [entry.path, entry]));
  assert.equal(expected.size, baseline.entries.length, 'duplicate baseline entries');
  const observed: string[] = [];
  for (const file of sourceFiles(resolve(root, 'src'))) {
    const bytes = readFileSync(file);
    if (!hasDirectProcessDependency(bytes.toString('utf8'))) continue;
    const path = file.slice(root.length + 1).replaceAll('\\', '/');
    observed.push(path);
    const entry = expected.get(path);
    assert.ok(entry, `New direct process dependency requires worker-boundary classification: ${path}`);
    assert.ok(entry.classification.trim(), `Missing process classification: ${path}`);
    assert.equal(createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex'), entry.sha256,
      `Process-capable source changed; review worker-launch impact before refreshing baseline: ${path}`);
  }
  assert.deepEqual(observed.sort(), [...expected.keys()].sort(), 'stale baseline entry; shrink rather than retain an obsolete exception');
});
test('process census catches literal builtin, CommonJS and worker-thread references', () => {
  for (const source of ['import {spawn} from "child_process";', 'require("node:child_process")',
    'process.getBuiltinModule("child_process")', 'await import("node:worker_threads")',
    'require(`node:child_process`)', 'process.getBuiltinModule(computedName)']) assert.ok(hasDirectProcessDependency(source));
  assert.equal(hasDirectProcessDependency('await supervisor.launch(request);'), false);
});


test('dependency traversal covers TSX/JSX as well as plain and module-specific script extensions', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'alix-process-census-'));
  try {
    mkdirSync(resolve(scratch, 'nested'));
    const extensions = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
    for (const extension of extensions) writeFileSync(resolve(scratch, 'nested', `worker.${extension}`), 'import {spawn} from "node:child_process";');
    writeFileSync(resolve(scratch, 'nested', 'data.json'), '{}');
    const files = sourceFiles(scratch);
    assert.equal(files.length, extensions.length);
    for (const extension of extensions) {
      const file = resolve(scratch, 'nested', `worker.${extension}`);
      assert.ok(files.includes(file), extension);
      assert.ok(hasDirectProcessDependency(readFileSync(file, 'utf8')), extension);
    }
  } finally {rmSync(scratch, {recursive: true, force: true});}
});
