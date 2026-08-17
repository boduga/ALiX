import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  ROLE_INSTRUCTIONS,
  DEFAULT_SUBAGENT_INSTRUCTIONS,
  getAgentDefinition,
  getPolicyBucket,
  defaultRoleConfigs,
} from "../../src/agents/agent-registry.js";

describe("canonical agent registry", () => {
  it("has exactly 6 entries covering the concrete SubagentRoles", () => {
    expect(AGENT_REGISTRY).toHaveLength(6);

    const roles = AGENT_REGISTRY.map((a) => a.role).sort();

    expect(roles).toEqual([
      "docs_researcher",
      "explorer",
      "researcher",
      "reviewer",
      "test_investigator",
      "worker",
    ]);
  });

  it("ROLE_INSTRUCTIONS is derived from the registry for every concrete role", () => {
    for (const def of AGENT_REGISTRY) {
      expect(ROLE_INSTRUCTIONS[def.role]).toBe(def.instructions);
    }
  });

  it("auto keeps its default instructions string", () => {
    expect(DEFAULT_SUBAGENT_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(ROLE_INSTRUCTIONS["auto"]).toBe(DEFAULT_SUBAGENT_INSTRUCTIONS);
  });

  it("getPolicyBucket returns the policy bucket per role", () => {
    expect(getPolicyBucket("worker")).toBe("write");
    expect(getPolicyBucket("researcher")).toBe("research");
    expect(getPolicyBucket("explorer")).toBe("read");
    expect(getPolicyBucket("auto")).toBeUndefined();
  });

  it("defaultRoleConfigs returns 6 entries including researcher with fast/read_only", () => {
    const configs = defaultRoleConfigs();

    expect(configs).toHaveLength(6);

    const researcher = configs.find((c) => c.role === "researcher")!;

    expect(researcher).toMatchObject({
      role: "researcher",
      mode: "read_only",
      style: "fast",
    });

    expect(
      configs.find((c) => c.role === "worker")!.retryCount,
    ).toBe(0);
    expect(researcher.retryCount).toBe(1);
  });

  it("getAgentDefinition returns the definition for a role and undefined for auto", () => {
    expect(getAgentDefinition("worker")?.instructions).toContain(
      "worker subagent",
    );

    expect(getAgentDefinition("auto")).toBeUndefined();
  });
});
