// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-N Task 4 — Structural sentinel for carve-out site.
 *
 * Pins the carve-out site at `src/capability/capability-service.ts` is rewritten
 * to discriminate by `candidate.sourcePatternId` (gap → create, deprecation_signal
 * → remove, others → transition). If anyone reverts the rewrite — e.g., hardcodes
 * `operation: "capability.transition"` as the only operation literal — these
 * assertions fail and surface the regression.
 *
 * Axis 1: function body contains all three operation literals
 *         (create, remove, transition).
 * Axis 2: function body contains a switch over sourcePatternId with the
 *         three branches (case "gap", case "deprecation_signal", default).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CAPABILITY_SERVICE_PATH = resolve(
  import.meta.dirname,
  "../../src/capability/capability-service.ts",
);

function readFunctionBody(name: string): string {
  const source = readFileSync(CAPABILITY_SERVICE_PATH, "utf8");
  // Simple, robust: extract the function body by brace counting from
  // `function name(` to its closing brace.
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

describe("CAP-N structural sentinel", () => {
  const body = readFunctionBody("candidateToExecutionStep");

  it("axis 1: function body contains all CAP-N/O/P operation literals (create, remove, update, consolidate) — 'transition' is NOT in the default fall-through anymore (CAP-P)", () => {
    // Pre-CAP-P: the discriminator's default case was
    // `capability.transition`. CAP-P removed that silent
    // fall-through — the default now throws. The closed discriminator
    // set: create (CAP-N), remove (CAP-N), update (CAP-O),
    // consolidate (CAP-P). `capability.transition` exists only as the
    // explicit `from → to` case which the producer of the source
    // signal names — there is no implicit default transition.
    expect(body).toContain('"capability.create"');
    expect(body).toContain('"capability.remove"');
    expect(body).toContain('"capability.update"');
    expect(body).toContain('"capability.consolidate"');
    // Sentinel: the discriminator's `default:` case THROWS rather
    // than emitting `capability.transition` — that was the bug CAP-P
    // closes. The check looks for the throwing default case marker
    // (`throw new Error`) following `default:` within a short span;
    // the regex is intentionally narrow so it doesn't match comment
    // text in the function's docstring.
    expect(body).toMatch(/default:\s*[\s\S]{0,1500}throw new Error/);
  });

  it("axis 2: function body switches on sourcePatternId with three cases", () => {
    expect(body).toMatch(/switch\s*\(\s*candidate\.sourcePatternId\s*\)/);
    expect(body).toContain('case "gap"');
    expect(body).toContain('case "deprecation_signal"');
    // default or trailing underperformer/consolidation_opportunity case
    expect(body).toMatch(/case\s+"underperformer"|default\s*:/);
  });
});