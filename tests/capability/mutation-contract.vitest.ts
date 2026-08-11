// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  isLegalTransition,
  CAPABILITY_MUTATION_OPERATIONS,
  classifyUpdateBump,
  validateConsolidateMerge,
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

function baseDefinition(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "tool.file.read", version: "1.0.0", kind: "operation",
    title: "Read a file", description: "Reads a file",
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [],
    ...over,
  };
}

describe("classifyUpdateBump (#479/#480 locked matrix)", () => {
  it("classifies identical definitions as PATCH (no change)", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition())).toBe("patch");
  });

  it("classifies PATCH fields as PATCH", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ title: "Read a file (updated)" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ description: "new description" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ examples: ["cat x"] }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ category: "files" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ risk: "medium" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ extensions: { note: "x" } }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ allowFallbacks: false }))).toBe("patch");
  });

  it("classifies MINOR fields as MINOR", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ aliases: ["readfile"] }))).toBe("minor");
    expect(classifyUpdateBump(a, baseDefinition({ tags: ["io"] }))).toBe("minor");
    expect(classifyUpdateBump(a, baseDefinition({ dependencies: ["core.session.list"] }))).toBe("minor");
  });

  it("classifies an added optional schema property as MINOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("minor");
  });

  it("classifies MAJOR fields as MAJOR", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ requiredPermissions: ["admin"] }))).toBe("major");
    expect(classifyUpdateBump(a, baseDefinition({ argsSchema: { type: "object", properties: {}, required: ["path"] } }))).toBe("major");
    expect(classifyUpdateBump(a, baseDefinition({ resultSchema: { type: "object", properties: {} } }))).toBe("major");
  });

  it("classifies a removed schema property as MAJOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies an optional→required schema property as MAJOR (semantic, not key-set)", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: [] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a shared-property type change as MAJOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "number" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a binding provider-technology change as MAJOR", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "cli-1" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a same-technology id swap as MAJOR (binding.id = provider identity)", () => {
    // canonical CAP-4 provider identity is binding.id — mcp-1 → mcp-2 is a
    // different serving provider, hence MAJOR, not MINOR (user tightening).
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }] });
    const b = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-2" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a config change as MAJOR even with type and id held constant", () => {
    // gh → gitnexus via config.executable is a provider swap despite the type
    // staying "external-cli" (user tightening — canonical identity = (type, id, config)).
    const a = baseDefinition({ bindings: [{ type: "external-cli", id: "gh", config: { executable: "gh" } }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "gh", config: { executable: "gitnexus" } }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a binding reorder as MAJOR (fallback priority is behavioral)", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }, { type: "external-cli", id: "gh" }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "gh" }, { type: "mcp", id: "mcp-1" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("treats an identical binding array as no binding change", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1", config: { timeoutMs: 5000 } }] });
    const b = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1", config: { timeoutMs: 5000 } }] });
    expect(classifyUpdateBump(a, b)).toBe("patch"); // nothing else changed → PATCH
  });

  it("is monotonic: any MAJOR-class change ⇒ MAJOR despite MINOR/PATCH changes", () => {
    const a = baseDefinition();
    const b = baseDefinition({
      title: "renamed",
      argsSchema: { type: "object", properties: { extra: { type: "string" } } },
      bindings: [{ type: "daemon", id: "d" }],
    });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });
});

function sourceDef(id: string, over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id, version: "1.0.0", kind: "operation", title: id, description: id,
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [{ type: "mcp", id: `${id}-mcp` }],
    ...over,
  };
}

// VALID fixture: target is a NEW id (not a source), risk is highest, permissions
// are the union, dependencies are the union, bindings explicit, no alias collision.
function proposal(over: Partial<CapabilityConsolidateMutation> = {}): CapabilityConsolidateMutation {
  return {
    operation: "capability.consolidate",
    sources: ["tool.file.read", "tool.file.tail"],
    target: "tool.file.combined",
    definition: sourceDef("tool.file.combined", {
      risk: "medium",
      requiredPermissions: ["operator", "admin"],
      dependencies: ["core.session.list"],
      aliases: ["readtail"],
    }),
    sourceDisposition: "deprecate",
    ...over,
  };
}

describe("validateConsolidateMerge (#477 conservative merge rules)", () => {
  // sources: tool.file.read has perms [operator], deps []; tool.file.tail has
  // perms [operator, admin], deps [core.session.list], aliases [tail].
  const sources = [
    sourceDef("tool.file.read"),
    sourceDef("tool.file.tail", { requiredPermissions: ["operator", "admin"], dependencies: ["core.session.list"], aliases: ["tail"] }),
  ];

  it("accepts a conservatively sound proposal", () => {
    const r = validateConsolidateMerge(proposal(), sources);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects when target is one of the sources", () => {
    const r = validateConsolidateMerge(proposal({ target: "tool.file.read" }), sources);
    expect(r.valid).toBe(false);
  });

  it("rejects empty or duplicate sources", () => {
    expect(validateConsolidateMerge(proposal({ sources: [] }), sources).valid).toBe(false);
    expect(validateConsolidateMerge(proposal({ sources: ["tool.file.read", "tool.file.read"] }), sources).valid).toBe(false);
  });

  it("rejects a kind mismatch between a source and the proposed target", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { kind: "query" }) }), sources).valid).toBe(false);
  });

  it("rejects proposed risk below the highest source risk", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { risk: "low" }) }), sources).valid).toBe(false);
  });

  it("rejects a missing source required permission (union)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { requiredPermissions: ["operator"] }) }), sources).valid).toBe(false);
  });

  it("rejects a missing source dependency (union)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { dependencies: [] }) }), sources).valid).toBe(false);
  });

  it("rejects empty proposed bindings (never blindly unioned)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { bindings: [] }) }), sources).valid).toBe(false);
  });

  it("rejects duplicate aliases within the proposed definition", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { aliases: ["tail", "tail"] }) }), sources).valid).toBe(false);
  });

  it("rejects a source id that does not resolve to a definition", () => {
    expect(validateConsolidateMerge(proposal({ sources: ["tool.file.read", "ghost.capability"] }), sources).valid).toBe(false);
  });
});
