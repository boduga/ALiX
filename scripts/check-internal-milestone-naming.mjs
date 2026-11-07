#!/usr/bin/env node
/** Reject retired GE-04 names in internal source filenames and identifiers.
 * Deliberately excludes versioned wire values, CLI flags and test fixtures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}
let failures = 0;
const obsolete = /\b(?:awaitGe04StartupRelease|createGe04LinuxWorkerLifecycle|Ge04SpawnIdentity|ge04WorkerLifecycle)\b|worker-ge04-(?:startup-gate|linux-lifecycle)/g;
for (const file of walk('src')) {
  if (/worker-ge04-(?:startup-gate|linux-lifecycle)/.test(file)) {
    console.error(`Retired source filename: ${file}`);
    failures++;
  }
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    for (const match of line.matchAll(obsolete)) {
      console.error(`${file}:${i + 1}: retired internal name ${match[0]}`);
      failures++;
    }
  }
}
if (failures) process.exitCode = 1;
else console.log('Internal supervisor milestone naming: PASS');
