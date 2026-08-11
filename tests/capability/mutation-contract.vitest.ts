// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  isLegalTransition,
  CAPABILITY_MUTATION_OPERATIONS,
} from "../../src/capability/mutation-contract.js";
import type {
  CapabilityCreateMutation,
  CapabilityUpdateMutation,
  CapabilityTransitionMutation,
  CapabilityConsolidateMutation,
  CapabilityRemoveMutation,
  CapabilityMutation,
} from "../../src/capability/mutation-contract.js";
import type { LifecycleState } from "../../src/adaptation/capability-evolution-types.js";
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";

const ALL_STATES: readonly LifecycleState[] = [
  "emerging", "active", "mature", "stagnant", "declining", "deprecated",
];

describe("LEGAL_LIFECYCLE_TRANSITIONS (#481 locked graph)", () => {
  it("covers exactly the six lifecycle states", () => {
    expect(Object.keys(LEGAL_LIFECYCLE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it("encodes the exact locked edge set", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.emerging).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.active).toEqual(["mature", "declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.mature).toEqual(["declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.stagnant).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.declining).toEqual(["deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toEqual([]);
  });

  it("has deprecated as a terminal state (no outgoing edges)", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toHaveLength(0);
  });

  it("is acyclic (no state can reach itself)", () => {
    for (const from of ALL_STATES) {
      const frontier = [...LEGAL_LIFECYCLE_TRANSITIONS[from]];
      const seen = new Set(frontier);
      while (frontier.length > 0) {
        const cur = frontier.pop()!;
        expect(cur).not.toBe(from);
        for (const next of LEGAL_LIFECYCLE_TRANSITIONS[cur]) {
          if (!seen.has(next)) { seen.add(next); frontier.push(next); }
        }
      }
    }
  });
});

describe("isLegalTransition", () => {
  it("accepts every legal edge from the locked graph", () => {
    expect(isLegalTransition("emerging", "active")).toBe(true);
    expect(isLegalTransition("emerging", "deprecated")).toBe(true);
    expect(isLegalTransition("active", "mature")).toBe(true);
    expect(isLegalTransition("active", "declining")).toBe(true);
    expect(isLegalTransition("mature", "declining")).toBe(true);
    expect(isLegalTransition("stagnant", "active")).toBe(true);
    expect(isLegalTransition("stagnant", "deprecated")).toBe(true);
    expect(isLegalTransition("declining", "deprecated")).toBe(true);
  });

  it("rejects edges not in the locked graph", () => {
    expect(isLegalTransition("active", "deprecated")).toBe(false); // #481: no active→deprecated
    expect(isLegalTransition("emerging", "mature")).toBe(false);
    expect(isLegalTransition("mature", "active")).toBe(false);
    expect(isLegalTransition("declining", "active")).toBe(false);
    expect(isLegalTransition("deprecated", "active")).toBe(false); // terminal
    expect(isLegalTransition("deprecated", "deprecated")).toBe(false);
  });

  it("rejects self-loops", () => {
    expect(isLegalTransition("active", "active")).toBe(false);
    expect(isLegalTransition("emerging", "emerging")).toBe(false);
  });

  it("is complete: every (from, to) not in the table is illegal", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
        expect(isLegalTransition(from, to)).toBe(expected);
      }
    }
  });
});

describe("CapabilityMutation payload types", () => {
  it("defines exactly the five governed mutation operations", () => {
    expect(CAPABILITY_MUTATION_OPERATIONS).toEqual([
      "capability.create",
      "capability.update",
      "capability.transition",
      "capability.consolidate",
      "capability.remove",
    ]);
  });

  it("discriminates each payload on its operation string", () => {
    const create: CapabilityMutation = {
      operation: "capability.create",
      definition: makeDefinition("tool.file.read", "1.0.0"),
    };
    const update: CapabilityMutation = {
      operation: "capability.update",
      capabilityId: "tool.file.read",
      sourceVersion: "1.0.0",
      patch: { title: "Read a file" },
    };
    const transition: CapabilityMutation = {
      operation: "capability.transition",
      capabilityId: "tool.file.read",
      from: "emerging",
      to: "active",
    };
    const consolidate: CapabilityMutation = {
      operation: "capability.consolidate",
      sources: ["tool.file.read", "tool.file.tail"],
      target: "tool.file.read",
      definition: makeDefinition("tool.file.read", "2.0.0"),
      sourceDisposition: "deprecate",
    };
    const remove: CapabilityMutation = {
      operation: "capability.remove",
      capabilityId: "tool.file.tail",
      reason: "superseded by tool.file.read",
    };
    expect(create.operation).toBe("capability.create");
    expect(update.operation).toBe("capability.update");
    expect(transition.operation).toBe("capability.transition");
    expect(consolidate.operation).toBe("capability.consolidate");
    expect(remove.operation).toBe("capability.remove");
  });

  it("update carries sourceVersion + patch (no 'modify current' shape)", () => {
    const u: CapabilityUpdateMutation = {
      operation: "capability.update",
      capabilityId: "tool.file.read",
      sourceVersion: "1.0.0",
      patch: { risk: "medium" },
    };
    expect(u.sourceVersion).toBe("1.0.0");
    // @ts-expect-error — patch must NOT accept the immutable kind field
    const bad: CapabilityUpdateMutation = { operation: "capability.update", capabilityId: "x", sourceVersion: "1.0.0", patch: { kind: "query" } };
    void bad;
  });

  it("consolidate requires an explicit proposed target definition + sourceDisposition", () => {
    const c: CapabilityConsolidateMutation = {
      operation: "capability.consolidate",
      sources: ["a.b", "a.c"],
      target: "a.b",
      definition: makeDefinition("a.b", "2.0.0"),
      sourceDisposition: "remove",
    };
    expect(c.sourceDisposition).toBe("remove");
  });

  it("transition carries explicit from + to (stale-decision precondition)", () => {
    const t: CapabilityTransitionMutation = {
      operation: "capability.transition",
      capabilityId: "tool.file.read",
      from: "active",
      to: "mature",
    };
    expect(t.from).toBe("active");
    expect(t.to).toBe("mature");
  });

  it("create carries a definition and no placeholder flag", () => {
    const c: CapabilityCreateMutation = {
      operation: "capability.create",
      definition: makeDefinition("tool.file.write", "1.0.0"),
    };
    expect(c.definition.id).toBe("tool.file.write");
  });

  it("remove carries a reason", () => {
    const r: CapabilityRemoveMutation = {
      operation: "capability.remove",
      capabilityId: "tool.file.tail",
      reason: "superseded",
    };
    expect(r.reason).toBe("superseded");
  });
});

// helper shared with later describe blocks in this file
function makeDefinition(id: string, version: string) {
  return {
    id, version, kind: "operation", title: id, description: id,
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [],
  } as CapabilityDefinition;
}
