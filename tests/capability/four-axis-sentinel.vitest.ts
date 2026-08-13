// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Four-axis sentinel (CAP-8 axis 1-3 + CAP-9 axis 4)", () => {
  it("axis 1: new CapabilityRegistry/Resolver only in composition root", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    // axis 1: A7 module MUST NOT construct registry/resolver
    expect(
      a7Src,
      "axis 1: A7 must not construct registry/resolver",
    ).not.toMatch(/new\s+(CapabilityRegistry|CapabilityResolver)/);
    expect(
      serviceSrc,
      "axis 1: service must not construct registry/resolver directly",
    ).not.toMatch(/new\s+(CapabilityRegistry|CapabilityResolver)/);
  });

  it("axis 4: A7 module contains no capability mutator call sites", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(
      a7Src,
      "axis 4: catalog.register forbidden in A7",
    ).not.toMatch(/catalog\.register/);
    expect(
      a7Src,
      "axis 4: catalog.remove forbidden in A7",
    ).not.toMatch(/catalog\.remove/);
    expect(
      a7Src,
      "axis 4: registry.setLifecycleState forbidden in A7",
    ).not.toMatch(/registry\.setLifecycleState/);
    expect(
      a7Src,
      "axis 4: registry.applyMutation forbidden in A7",
    ).not.toMatch(/registry\.applyMutation/);
  });

  it("axis 4: A7 module does not import from forbidden catalog/registry/policy modules", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(
      a7Src,
      "axis 4: A7 must not import capability/canonical mutators",
    ).not.toMatch(/from\s+["'].*capability\/canonical\/catalog["']/);
    expect(
      a7Src,
      "axis 4: A7 must not import evolution/capability-lifecycle",
    ).not.toMatch(/from\s+["'].*evolution\/capability-lifecycle/);
    expect(
      a7Src,
      "axis 4: A7 must not import policy/capability-registry",
    ).not.toMatch(/from\s+["'].*policy\/capability-registry/);
    expect(
      a7Src,
      "axis 4: A7 must not import tools/tool-registry",
    ).not.toMatch(/from\s+["'].*tools\/tool-registry/);
  });

  it("axis 4: governance() projection must not call catalog/registry mutators", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    // Slice out the governance() method body (anchor on 2-space indent for both
    // opening and closing brace so the non-greedy match stops at the method's
    // closing brace, not the class closing brace)
    const match = serviceSrc.match(/^ {2}async governance[\s\S]+?^ {2}}/m);
    expect(match, "governance() method must exist").not.toBeNull();
    const body = match![0];
    expect(
      body,
      "axis 4 ruling #23: governance() must not call catalog.get|list|query",
    ).not.toMatch(/catalog\.(get|list|query)/);
    expect(
      body,
      "axis 4 ruling #23: governance() must not call registry.list|query",
    ).not.toMatch(/registry\.(list|query)/);
    expect(
      body,
      "axis 4 ruling #23: governance() must not call mutate family",
    ).not.toMatch(/\.mutate/);
  });
});