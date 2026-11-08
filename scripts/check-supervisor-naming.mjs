#!/usr/bin/env node
/**
 * Enforce stable architectural names in production TypeScript.
 * Historical tests, qualification probes and signed wire values are preserved.
 * Exact compatibility exceptions are documented here, not broad file skips.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path)
      : entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

const files = [
  ...sourceFiles('src'),
  'scripts/ge04-release-verify.mjs',
  'native/ge04/isolated-worker-launcher.c',
];
// Exception values are persisted wire/denial contracts or qualification-only
// switches; renaming requires a reviewed compatibility migration.
const legacyValues = [
  'ALIX_GE04_RELEASE_V1',
  'ALIX_GE04_RECOVERY_V1',
  'ALIX_GE04_FINAL_EFFECT_V1',
  'GE04_RECOVERY_NOT_QUALIFIED',
  'GE04_FINAL_EFFECT_UNQUALIFIED',
  'ALIX_GE04_Q330_LINUX_TEST',
  'GE04_READY',
  'ge04-startup-fd',
  'ge04-route-preflight',
  'ge04-owner-id',
];
const banned = /\b(?:[A-Z][A-Z0-9]*_)*GE04_[A-Z][A-Z0-9_]*\b|\b(?:ge04|Ge04)[A-Z][A-Za-z0-9]*\b|--ge04-[a-z-]+|\bge04_[a-z][a-z0-9_]*\b/g;
let failures = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    let checked = line;
    for (const value of legacyValues) checked = checked.replaceAll(value, '');
    for (const match of checked.matchAll(banned)) {
      console.error(`${file}:${index + 1}: milestone-prefixed production identifier ${match[0]}`);
      failures++;
    }
  });
}
if (failures) process.exitCode = 1;
else console.log(`Production identifier naming: PASS (${files.length} files scanned)`);
