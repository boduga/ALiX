// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Resolve source paths from the project root (where tests are executed).
 *  Compiled (node:test) tests run with `cwd` set to the project root;
 *  this avoids the `dist/` prefix the `import.meta.url` approach would
 *  produce when the test is loaded from `dist/tests/`. */
const PROJECT_ROOT = process.cwd();
const CAPABILITIES_CLI = join(PROJECT_ROOT, 'src/cli/commands/capabilities.ts');
const LIFECYCLE_CLI = join(PROJECT_ROOT, 'src/evolution/capability-lifecycle/capability-lifecycle-cli.ts');

describe('CLI capabilities migration (locked ruling #7)', () => {
  it('src/cli/commands/capabilities.ts routes through CapabilityService', () => {
    const text = readFileSync(CAPABILITIES_CLI, 'utf8');
    assert.match(text, /CapabilityService/, 'must import reference CapabilityService');
    assert.doesNotMatch(text, /new\s+CapabilityRegistry\s*\(/);
    assert.doesNotMatch(text, /new\s+CapabilityResolver\s*\(/);
    assert.doesNotMatch(text, /registry\.(query|setLifecycleState|reload)/);
    assert.doesNotMatch(text, /catalog\.(register|remove|update)/);
  });

  it('capability-lifecycle-cli.ts routes through CapabilityService (or delegates module does)', () => {
    const text = readFileSync(LIFECYCLE_CLI, 'utf8');
    // Either itself uses CapabilityService, OR delegates module does.
    // structural sentinel accepts either.
    const hasServiceRef =
      /CapabilityService/.test(text) ||
      /capability-service/.test(text) ||
      /from\s+["']\.\.\/\.\.\/capability\/capability-service\.js["']/.test(text);
    assert.ok(hasServiceRef, 'capability-lifecycle-cli must reach capability semantics through CapabilityService');
    assert.doesNotMatch(text, /new\s+CapabilityRegistry\s*\(/);
  });
});
