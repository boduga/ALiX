/**
 * mp-01-reader-parity.vitest.ts — MP-01 runtime reader parity for subagent model
 * resolution.
 *
 * WHY THIS EXISTS
 *
 * `SubagentManager.getRoleModel` read `config.subagents[style]`, a DERIVED
 * projection the loader fills for compatibility. MP-02 retires that projection,
 * so a reader bound to it would break on the very change that removes the field.
 * This suite pins the parity MP-01 promises: the canonical `models` object decides
 * the model, precedence is unchanged, and the result does not depend on the
 * projection being present.
 *
 * The last property is the one that fails if someone "fixes" a future break by
 * reading the projection again — which would pass today and fail after MP-02.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { SubagentManager } from "../../src/agents/subagent-manager.js";
import type { AlixConfig, ModelTier, SubagentRole } from "../../src/operations/config/schema.js";

/** Build a config whose canonical `models` carries every tier. */
function configWith(overrides: Partial<Record<ModelTier, { provider: string; name: string }>> = {}): AlixConfig {
  const models: Record<string, { provider: string; name: string }> = {
    default: { provider: "p-default", name: "m-default" },
  };
  for (const tier of ["thinking", "coding", "fast", "critic", "tiny", "image"] as const) {
    models[tier] = { provider: `p-${tier}`, name: `m-${tier}` };
  }
  Object.assign(models, overrides);
  return {
    models,
    subagents: {
      enabled: true,
      roles: [
        { role: "explorer", mode: "read_only", style: "fast" },
        { role: "worker", mode: "write", style: "coding" },
        { role: "reviewer", mode: "read_only", style: "critic" },
        { role: "planner", mode: "read_only" },
      ],
    },
  } as unknown as AlixConfig;
}

function manager(config: AlixConfig): SubagentManager {
  return new SubagentManager({ config } as never);
}

describe("MP-01 subagent model parity", () => {
  it("resolves each role's declared style from the canonical models object", () => {
    const mgr = manager(configWith());
    expect(mgr.getRoleModel("explorer" as SubagentRole)).toEqual({ provider: "p-fast", name: "m-fast" });
    expect(mgr.getRoleModel("worker" as SubagentRole)).toEqual({ provider: "p-coding", name: "m-coding" });
    expect(mgr.getRoleModel("reviewer" as SubagentRole)).toEqual({ provider: "p-critic", name: "m-critic" });
  });

  it("falls back to the fast tier when a role declares no style", () => {
    // Precedence preserved exactly: `roleConfig?.style ?? "fast"`.
    const mgr = manager(configWith());
    expect(mgr.getRoleModel("planner" as SubagentRole)).toEqual({ provider: "p-fast", name: "m-fast" });
  });

  it("falls back to the default model when a declared tier is absent", () => {
    const config = configWith();
    delete (config.models as Record<string, unknown>).critic;
    const mgr = manager(config);
    expect(mgr.getRoleModel("reviewer" as SubagentRole)).toEqual({ provider: "p-default", name: "m-default" });
  });

  it("does NOT depend on the derived subagents.<tier> projection", () => {
    // The projection a future MP-02 removes entirely. Resolution must still work.
    const config = configWith();
    delete (config as unknown as { subagents: Record<string, unknown> }).subagents.fast;
    delete (config as unknown as { subagents: Record<string, unknown> }).subagents.coding;
    delete (config as unknown as { subagents: Record<string, unknown> }).subagents.critic;
    const mgr = manager(config);
    expect(mgr.getRoleModel("explorer" as SubagentRole)).toEqual({ provider: "p-fast", name: "m-fast" });
    expect(mgr.getRoleModel("worker" as SubagentRole)).toEqual({ provider: "p-coding", name: "m-coding" });
  });

  it("canonical models WIN when the projection disagrees", () => {
    // The load-bearing property. A reader that prefers the projection when
    // present — even with a canonical fallback — passes a "projection absent"
    // test and is exactly what MP-02 would break. Only a disagreeing fixture
    // distinguishes "reads canonical" from "reads projection, falls back".
    const config = configWith();
    const subagents = (config as unknown as { subagents: Record<string, unknown> }).subagents;
    subagents.fast = { provider: "stale", name: "stale-fast" };
    subagents.coding = { provider: "stale", name: "stale-coding" };
    const mgr = manager(config);
    expect(mgr.getRoleModel("explorer" as SubagentRole)).toEqual({ provider: "p-fast", name: "m-fast" });
    expect(mgr.getRoleModel("worker" as SubagentRole)).toEqual({ provider: "p-coding", name: "m-coding" });
  });

  it("throws the documented error when no tier and no default resolve", () => {
    const config = configWith();
    delete (config.models as Record<string, unknown>).fast;
    delete (config.models as Record<string, unknown>).default;
    const mgr = manager(config);
    expect(() => mgr.getRoleModel("explorer" as SubagentRole)).toThrow(/unconfigured/);
  });

  it("returns a copied object, so a caller cannot mutate config through it", () => {
    const config = configWith();
    const mgr = manager(config);
    const resolved = mgr.getRoleModel("explorer" as SubagentRole);
    resolved.name = "mutated";
    expect((config.models as Record<string, { name: string }>).fast!.name).toBe("m-fast");
  });

  it("resolves every declared tier to that tier, not to the default", () => {
    // One role per tier, so each of the six canonical tiers is exercised through
    // the real role path rather than a direct resolver call.
    const tiers = ["thinking", "coding", "fast", "critic", "tiny", "image"] as const;
    for (const tier of tiers) {
      const base = configWith();
      const config = {
        ...base,
        subagents: {
          ...(base.subagents as Record<string, unknown>),
          roles: [{ role: "worker", mode: "write", style: tier }],
        },
      } as unknown as AlixConfig;
      const resolved = manager(config).getRoleModel("worker" as SubagentRole);
      expect(resolved, tier).toEqual({ provider: `p-${tier}`, name: `m-${tier}` });
      expect(resolved.name, tier).not.toBe("m-default");
    }
  });
});
