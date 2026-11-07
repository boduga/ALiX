#!/usr/bin/env node
/**
 * Permanent supervisor code must not acquire milestone-prefixed identifiers.
 * Historical qualification fixtures, signed wire protocols, and installed
 * trust paths are deliberately outside this symbol-level guard.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [
  ...readdirSync('src/agents').filter(name => /^worker-supervisor(?:-|\.)/.test(name) && name.endsWith('.ts')).map(name => join('src/agents', name)),
  'scripts/ge04-release-verify.mjs',
  'native/ge04/isolated-worker-launcher.c',
];
const banned = /\b(?:GE04|GE_04|GE-04)_(?:[A-Z][A-Z0-9_]*)\b|\b(?:ge04|ge_04)_[a-z][a-z0-9_]*\b/g;
let failures = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // Preserve signed protocol and independently provisioned path contracts.
    if (file === 'scripts/ge04-release-verify.mjs' &&
        (/ALIX_GE04_RELEASE_V1/.test(line) || /\/alix\/ge04\//.test(line))) return;
    for (const match of line.matchAll(banned)) {
      console.error(`${file}:${index + 1}: milestone-prefixed production identifier ${match[0]}`);
      failures++;
    }
  });
}
if (failures) process.exitCode = 1;
else console.log('Supervisor production identifier naming: PASS');
