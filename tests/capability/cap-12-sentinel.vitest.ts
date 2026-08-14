// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-12 — Structural sentinel (T3, 4 axes).
 *
 * Static guards against the four regressions CAP-12 closes:
 * 1. Second-registry regression (CAP-1 invariant) — `new CapabilityRegistry(`
 *    must appear only in `src/capability/platform.ts` (composition root).
 *    Any consumer-side construction is a regression: the capability
 *    universe must be reached through the single registered surface.
 * 2. Legacy lifecycle machinery regression (CAP-11 deletion) — the
 *    retired `registerLifecycleApplier` / `applyLifecycleTransition` /
 *    `APPROVED_PENDING_APPLICATION` literals must NOT reappear in source.
 *    Test files may reference them historically; this axis scans only
 *    `src/`.
 * 3. Orphan tests pointing at the legacy machine (CAP-11 cleanup) —
 *    `tests/evolution/capability-lifecycle/` was deleted by CAP-11 and
 *    must stay deleted. Its return would silently re-enable the
 *    A7.0/A7.1 split-surface regression.
 * 4. A7.0/A7.1 split-surface assumption presented as active architecture
 *    (CAP-12 documentation migration closure) — `docs/architecture/README.md`
 *    must not present A7.0/A7.1 docs as the current architecture. The
 *    A7.0/A7.1 checkpoint docs carry SUPERSEDED notices; the architecture
 *    README must point to ADR-0013 + greenfield architecture design.
 *
 * Each axis is a **hard guard** (not a soft check): a single failure
 * fails the test, which fails the CAP-12 gate. Pattern mirrors
 * `tests/capability/five-axis-sentinel.vitest.ts` and
 * `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts`.
 *
 * @module capability/cap-12-sentinel
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Grep `src/ tests/` for a pattern using `grep -rEn`. Returns the raw
 * stdout (matching lines including file:line:content). Empty string means
 * zero matches.
 */
function grepSources(pattern: string, scope: "src" | "tests" = "src"): string {
  try {
    return execSync(
      `grep -rEn "${pattern}" ${ROOT}/${scope}/ 2>/dev/null || true`,
      { encoding: "utf8" },
    );
  } catch (e) {
    // `grep -rEn` exits 1 on no matches even with `|| true`; treat that
    // as empty output so the caller's assertion can decide.
    return "";
  }
}

describe("CAP-12 — Structural sentinel (4 axes)", () => {
  it("axis 1: no `new CapabilityRegistry(` outside src/capability/platform.ts (CAP-1 invariant)", () => {
    const matches = grepSources("new\\s+CapabilityRegistry\\(");
    // Filter out the composition root's own construction line; any other
    // hit is a regression.
    const offenders = matches
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((line) => !line.includes("src/capability/platform.ts:"));
    expect(
      offenders,
      `new CapabilityRegistry( must only appear in src/capability/platform.ts; offenders:\\n${offenders.join(
        "\\n",
      )}`,
    ).toEqual([]);
  });

  it("axis 2: no legacy lifecycle machinery reintroduced in src/ (CAP-11 deletion)", () => {
    // CAP-11 retired: registerLifecycleApplier, applyLifecycleTransition,
    // APPROVED_PENDING_APPLICATION. Any reappearance in src/ is a regression.
    const markers = [
      "registerLifecycleApplier",
      "applyLifecycleTransition",
      "APPROVED_PENDING_APPLICATION",
    ];
    const offenders: string[] = [];
    for (const m of markers) {
      const out = grepSources(m);
      const lines = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      offenders.push(...lines.map((l) => `[${m}] ${l}`));
    }
    expect(
      offenders,
      `Legacy lifecycle machinery must not reappear in src/; offenders:\\n${offenders.join(
        "\\n",
      )}`,
    ).toEqual([]);
  });

  it("axis 3: tests/evolution/capability-lifecycle/ stays deleted (CAP-11 cleanup)", () => {
    const legacyDir = resolve(ROOT, "tests/evolution/capability-lifecycle");
    expect(
      existsSync(legacyDir),
      "legacy test directory must stay removed (CAP-11 deletion)",
    ).toBe(false);
  });

  it("axis 4: docs/architecture/README.md does not present A7.0/A7.1 as active architecture (CAP-12 doc-migration closure)", () => {
    const readmePath = resolve(ROOT, "docs/architecture/README.md");
    const readme = readFileSync(readmePath, "utf8");

    // A7.0/A7.1 design / checkpoint docs are SUPERSEDED historical record.
    // The README must not present them as active architecture. The README
    // does mention ADR-0013 as the canonical capability architecture, which
    // is the acceptable active reference. A7.0/A7.1 may be referenced only
    // as historical / superseded markers, never as the current architecture.
    const lines = readme.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      // Hard-coded must-not-appear phrasings that would present A7.0/A7.1
      // as active architecture. References to ADR-0013 or the greenfield
      // architecture are active; mentions of A7.0/A7.1 are only allowed in
      // supersession / historical context (which the README does not in
      // practice contain).
      if (
        /\ba7\.0\b/i.test(line) ||
        /\ba7\.1\b/i.test(line) ||
        /\ba7-0\b/i.test(line) ||
        /\ba7-1\b/i.test(line) ||
        /capability marketplace/i.test(line) ||
        /capability application/i.test(line)
      ) {
        // Allow only if the line also carries a supersession marker.
        const isSupersession =
          /superseded/i.test(line) ||
          /historical/i.test(line) ||
          /retired/i.test(line);
        if (!isSupersession) {
          offenders.push(line);
        }
      }
    }
    expect(
      offenders,
      `docs/architecture/README.md must not present A7.0/A7.1 as active architecture; offending lines:\\n${offenders.join(
        "\\n",
      )}`,
    ).toEqual([]);
  });
});
