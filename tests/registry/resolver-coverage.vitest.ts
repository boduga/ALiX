import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCapabilities } from "../../src/registry/capability-resolver.js";
import { loadCardRegistry } from "../../src/registry/card-loader.js";
import type { CardRegistry } from "../../src/registry/card-registry.js";

const RETIRED_AGENT_IDS = new Set([
  "orchestrator.core",
  "planner.graph",
  "memory.curator",
  "research.scout",
  "critic.general",
  "artifact.writer",
]);

function makeTemp(): string {
  return mkdtempSync(join(tmpdir(), "resolver-coverage-"));
}

describe("resolver coverage (issue #560 criterion 3)", () => {
  it("a research node selects researcher and never a retired id", async () => {
    const tmp = makeTemp();
    try {
      const registry: CardRegistry = await loadCardRegistry(tmp);

      const result = resolveCapabilities({
        requiredCapabilities: ["web.search", "web.fetch"],
        domain: "research",
        executionProfile: "research",
        registry,
      });

      const agentIds = result.agents.map((a) => a.id);
      expect(agentIds).toContain("researcher");

      for (const id of ["research.scout", "orchestrator.core", "planner.graph", "memory.curator"]) {
        expect(agentIds).not.toContain(id);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a general node requiring filesystem.read selects explorer", async () => {
    const tmp = makeTemp();
    try {
      const registry: CardRegistry = await loadCardRegistry(tmp);

      const result = resolveCapabilities({
        requiredCapabilities: ["filesystem.read"],
        registry,
      });

      const agentIds = result.agents.map((a) => a.id);
      expect(agentIds).toContain("explorer");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no capability query ever returns a retired agent id", async () => {
    const tmp = makeTemp();
    try {
      const registry: CardRegistry = await loadCardRegistry(tmp);

      const queries = [
        ["web.search"],
        ["filesystem.write"],
        ["filesystem.read"],
        ["shell.exec"],
        ["task.complete"],
      ];

      for (const requiredCapabilities of queries) {
        const result = resolveCapabilities({
          requiredCapabilities,
          registry,
        });

        for (const agent of result.agents) {
          expect(
            RETIRED_AGENT_IDS.has(agent.id),
            `${agent.id} must not be returned for ${requiredCapabilities.join(",")}`,
          ).toBe(false);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
