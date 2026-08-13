// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Five-axis sentinel.
 *
 * Mirrors CAP-9 four-axis sentinel (axes 1-4) and ADDS axis 5 (NEW) —
 * measurement purity — for CAP-10 A5 measurement integration.
 *
 * Axes covered:
 *   1. CAP-8 — `new CapabilityRegistry()` / `new CapabilityResolver()`
 *      only in composition root (`src/capability/platform.ts`).
 *   2. CAP-8 — no direct imports of `CapabilityRegistry` / `CapabilityResolver`
 *      from CAP-9 / CAP-10 production files (covered indirectly by axis 1).
 *   3. CAP-8 — CLI capability commands route through `CapabilityService`
 *      (covered by service.measure body purity + axis 1).
 *   4. CAP-9 — A7 generator source MUST NOT contain capability mutators;
 *      `governance()` body MUST NOT call catalog/registry mutators.
 *   5. CAP-10 NEW — A5 implementation has no mutators; engine imports A5
 *      interface only (not the impl); service.measure() body has no mutators;
 *      service does NOT bypass engine / A5 implementation.
 *
 * Notable brief bugs fixed inline:
 *   - Brief assumed `service.ts` would `import type { A5Measurement }` from
 *     `capability/measurement/a5`, but the architecture is service -> engine
 *     -> A5 (service consumes the orchestrator, never the A5 interface or
 *     impl directly). Last assertion re-cast as a non-bypass check.
 *   - Brief's positive regex `/from\s+["'].*capability\/measurement\/a5/`
 *     did not match the engine's relative import `./a5.js`. Replaced with a
 *     path-suffix check `/from\s+["'][^"']*\/a5(\.js)?["']/` that accepts the
 *     canonical relative form.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Five-axis sentinel (CAP-8/9 axes 1-4 + CAP-10 axis 5 NEW)", () => {
  it("axis 1: new CapabilityRegistry/Resolver only in composition root", () => {
    const platformSrc = readSrc("src/capability/platform.ts");
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const a5Src = readSrc("src/evolution/observation/a5-capability-measurement.ts");
    const engineSrc = readSrc("src/capability/measurement/capability-measurement-engine.ts");
    expect(platformSrc, "platform constructs CapabilityRegistry").toMatch(/new\s+CapabilityRegistry\(/);
    expect(platformSrc, "platform constructs CapabilityResolver").toMatch(/new\s+CapabilityResolver\(/);
    for (const [name, src] of [
      ["service", serviceSrc],
      ["a5", a5Src],
      ["engine", engineSrc],
    ] as const) {
      expect(
        src,
        `axis 1: ${name} must not construct CapabilityRegistry`,
      ).not.toMatch(/new\s+CapabilityRegistry\(/);
      expect(
        src,
        `axis 1: ${name} must not construct CapabilityResolver`,
      ).not.toMatch(/new\s+CapabilityResolver\(/);
    }
  });

  it("axis 4: A7 module contains no capability mutator call sites (CAP-9 preserved)", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(a7Src, "axis 4: catalog.register forbidden in A7").not.toMatch(/catalog\.register/);
    expect(a7Src, "axis 4: catalog.remove forbidden in A7").not.toMatch(/catalog\.remove/);
    expect(a7Src, "axis 4: registry.setLifecycleState forbidden in A7").not.toMatch(/registry\.setLifecycleState/);
    expect(a7Src, "axis 4: registry.applyMutation forbidden in A7").not.toMatch(/registry\.applyMutation/);
  });

  it("axis 4: governance() projection body remains catalog/registry-pure (CAP-9 ruling #23)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const match = serviceSrc.match(/^ {2}async governance[\s\S]+?^ {2}}/m);
    expect(match, "governance() method must exist").not.toBeNull();
    const body = match![0];
    expect(body, "axis 4: governance() must not call catalog.get|list|query").not.toMatch(/catalog\.(get|list|query)/);
    expect(body, "axis 4: governance() must not call registry.list|query").not.toMatch(/registry\.(list|query)/);
    expect(body, "axis 4: governance() must not call mutate family").not.toMatch(/\.mutate/);
  });

  it("axis 5 NEW: A5 implementation contains no capability mutators (ruling #5, #9, #10)", () => {
    const a5Src = readSrc("src/evolution/observation/a5-capability-measurement.ts");
    expect(a5Src, "axis 5: A5 must not call catalog.register").not.toMatch(/catalog\.register/);
    expect(a5Src, "axis 5: A5 must not call catalog.remove").not.toMatch(/catalog\.remove/);
    expect(a5Src, "axis 5: A5 must not call registry.setLifecycleState").not.toMatch(/registry\.setLifecycleState/);
    expect(a5Src, "axis 5: A5 must not call registry.applyMutation").not.toMatch(/registry\.applyMutation/);
    expect(
      a5Src,
      "axis 5: A5 must not import capability-lifecycle-measurer (ruling #9)",
    ).not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
  });

  it("axis 5 NEW: CapabilityMeasurementEngine consumes A5 via interface only (ruling #7, #9)", () => {
    const engineSrc = readSrc("src/capability/measurement/capability-measurement-engine.ts");
    expect(
      engineSrc,
      "axis 5: engine must not import a5-capability-measurement implementation (ruling #7)",
    ).not.toMatch(/from\s+["'].*evolution\/observation\/a5-capability-measurement/);
    expect(
      engineSrc,
      "axis 5: engine must import A5Measurement interface from capability/measurement/a5",
    ).toMatch(/from\s+["'][^"']*\/a5(\.js)?["']/);
    expect(
      engineSrc,
      "axis 5: engine must not import capability-lifecycle-measurer (ruling #9)",
    ).not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
  });

  it("axis 5 NEW: service.measure() body does not mutate capability state (ruling #23)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const match = serviceSrc.match(/^ {2}async measure[\s\S]+?^ {2}}/m);
    expect(match, "measure() method must exist").not.toBeNull();
    const body = match![0];
    expect(body, "axis 5: measure() must not call catalog.mutate").not.toMatch(/catalog\.mutate/);
    expect(body, "axis 5: measure() must not call registry.applyMutation").not.toMatch(/registry\.applyMutation/);
    expect(body, "axis 5: measure() must not call catalog.register").not.toMatch(/catalog\.register/);
    expect(body, "axis 5: measure() must not call catalog.remove").not.toMatch(/catalog\.remove/);
  });

  it("axis 5 NEW: service must not bypass engine / A5 implementation (ruling #7, #9)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    expect(
      serviceSrc,
      "axis 5: service must not import the A5 implementation",
    ).not.toMatch(/from\s+["'].*evolution\/observation\/a5-capability-measurement/);
    expect(
      serviceSrc,
      "axis 5: service must not import capability-lifecycle-measurer (ruling #9)",
    ).not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
    expect(
      serviceSrc,
      "axis 5: service must consume A5MeasurementEngine (the orchestrator) so it does not bypass capability measurement",
    ).toMatch(/CapabilityMeasurementEngine/);
  });
});
