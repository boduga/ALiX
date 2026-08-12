// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const COMPOSITION_ROOT = fileURLToPath(new URL('../../src/capability/platform.ts', import.meta.url));
const CAPABILITY_DIR = fileURLToPath(new URL('../../src/capability/', import.meta.url));
const MIGRATED_CLI_FILES = new Set<string>([
  fileURLToPath(new URL('../../src/cli/commands/capabilities.ts', import.meta.url)),
]);

const CAPABILITY_REGISTRY_RE = /new\s+CapabilityRegistry\s*\(/g;
const CAPABILITY_RESOLVER_RE = /new\s+CapabilityResolver\s*\(/g;

/**
 * CAP-11 debt exclusion list — these files pre-date CAP-8 and import
 * CapabilityRegistry/CapabilityResolver by name outside the capability/
 * module. The CAP-8 sentinel allows the existing debt explicitly so the
 * structural rule can be locked-in for new code; CAP-11 removes each entry
 * as it migrates the corresponding consumer to CapabilityService.
 *
 * DO NOT add new entries here in CAP-8 — that would silently re-introduce
 * the bypass the sentinel exists to prevent.
 */
const CAP11_DEBT_FILES: ReadonlySet<string> = new Set<string>([
  fileURLToPath(new URL('../../src/evolution/capability-lifecycle/capability-lifecycle-rehydration.ts', import.meta.url)),
  fileURLToPath(new URL('../../src/evolution/capability-lifecycle/capability-lifecycle-applier.ts', import.meta.url)),
  fileURLToPath(new URL('../../src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts', import.meta.url)),
  fileURLToPath(new URL('../../src/evolution/execution/capability-mutation-executor.ts', import.meta.url)),
  fileURLToPath(new URL('../../src/integrations/session-capabilities.ts', import.meta.url)),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

describe('Axis 1 — composition-root construction (locked ruling #2)', () => {
  it('new CapabilityRegistry() / new CapabilityResolver() exist ONLY in the composition root', () => {
    const files = walk(REPO_SRC);
    const violations: { file: string; line: number; match: string }[] = [];
    for (const f of files) {
      if (f === COMPOSITION_ROOT) continue;
      const text = readFileSync(f, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(CAPABILITY_REGISTRY_RE) ?? lines[i]!.match(CAPABILITY_RESOLVER_RE);
        if (m) violations.push({ file: f, line: i + 1, match: m[0] });
      }
    }
    expect(violations, `axis 1: registry/resolver construction outside composition root — ${JSON.stringify(violations)}`).toEqual([]);
  });
});

describe('Axis 2 — import boundary (locked ruling #2)', () => {
  it('files outside the capability module + migrated CLI do not import CapabilityRegistry or CapabilityResolver (CAP-11 debt excluded)', () => {
    const files = walk(REPO_SRC);
    const violations: string[] = [];
    for (const f of files) {
      if (f.startsWith(CAPABILITY_DIR)) continue;
      if (MIGRATED_CLI_FILES.has(f)) continue;
      if (CAP11_DEBT_FILES.has(f)) continue;
      const text = readFileSync(f, 'utf8');
      // Match imports of the PLATFORM CapabilityRegistry / CapabilityResolver by name
      // from the canonical platform modules only. This MUST NOT match the
      // unrelated policy-side `CapabilityRegistry` class in
      // `src/policy/capability-registry.ts` (which is a different module with
      // the same class name — pre-CAP-2, narrow scope).
      const importRegistry = /import\s+(?:type\s+)?\{[^}]*\bCapabilityRegistry\b[^}]*\}\s*from\s*["'][^"']*capability\/(?:registry|provider-resolver)\.js["']/;
      const importResolver = /import\s+(?:type\s+)?\{[^}]*\bCapabilityResolver\b[^}]*\}\s*from\s*["'][^"']*capability\/provider-resolver\.js["']/;
      if (importRegistry.test(text)) violations.push(`axis 2: registry imported — ${f}`);
      if (importResolver.test(text)) violations.push(`axis 2: resolver imported — ${f}`);
    }
    expect(violations, `axis 2: outside-capability imports of registry/resolver — ${violations.join('; ')}`).toEqual([]);
  });
});

describe('Axis 3 — migrated CLI call sites use CapabilityService (locked ruling #7)', () => {
  it('migrated CLI commands import and use CapabilityService; no direct registry/resolver access', () => {
    const violations: string[] = [];
    for (const f of MIGRATED_CLI_FILES) {
      const text = readFileSync(f, 'utf8');
      if (!/CapabilityService/.test(text)) violations.push(`axis 3: capabilities CLI does not import CapabilityService — ${f}`);
      if (/new\s+CapabilityRegistry\s*\(/.test(text)) violations.push(`axis 3: capabilities CLI constructs CapabilityRegistry directly — ${f}`);
      if (/new\s+CapabilityResolver\s*\(/.test(text)) violations.push(`axis 3: capabilities CLI constructs CapabilityResolver directly — ${f}`);
      if (/registry\.query|catalog\.register|registry\.setLifecycleState|catalog\.remove/.test(text)) violations.push(`axis 3: capabilities CLI reaches past CapabilityService — ${f}`);
    }
    expect(violations, `axis 3: migrated CLI commands bypass CapabilityService — ${violations.join('; ')}`).toEqual([]);
  });
});
