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
  'src/agents/subagent-cli.ts',
  'src/agents/subagent-manager.ts',
  'src/agents/worker-ge04-startup-gate.ts',
  'src/agents/worker-ge04-linux-lifecycle.ts',
  'scripts/ge04-release-verify.mjs',
  'native/ge04/isolated-worker-launcher.c',
];
const banned = /\b(?:[A-Z][A-Z0-9]*_)*GE04_[A-Z][A-Z0-9_]*\b|\b(?:ge04|Ge04)[A-Z][A-Za-z0-9]*\b|--ge04-[a-z-]+|\bge04_[a-z][a-z0-9_]*\b/g;
let failures = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // Preserve signed protocol and independently provisioned path contracts.
    const checked = file === 'scripts/ge04-release-verify.mjs'
      ? line.replaceAll('ALIX_GE04_RELEASE_V1', '') : line;
    for (const match of checked.matchAll(banned)) {
      console.error(`${file}:${index + 1}: milestone-prefixed production identifier ${match[0]}`);
      failures++;
    }
  });
}
if (failures) process.exitCode = 1;
else console.log('Supervisor production identifier naming: PASS');
