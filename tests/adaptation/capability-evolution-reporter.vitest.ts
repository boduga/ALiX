import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityEvolutionStore } from "../../src/adaptation/capability-evolution-store.js";
import type { IntelligenceReport } from "../../src/adaptation/intelligence-types.js";

describe("CapabilityEvolutionReporter", () => {
  let dir: string;
  let store: CapabilityEvolutionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "capevol-rep-"));
    store = new CapabilityEvolutionStore(join(dir, "reports"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces report with no agent cards", async () => {
    const { CapabilityEvolutionReporter } = await import("../../src/adaptation/capability-evolution-reporter.js");
    const reporter = new CapabilityEvolutionReporter(
      join(dir, "cards"),
      { loadLatest: async () => null },
      { list: async () => [] },
      { query: async () => ({ records: [] }) },
      store,
    );
    const report = await reporter.generateReport();
    expect(report.totalCapabilities).toBe(0);
    expect(report.healthAnalysis).toHaveLength(0);
    expect(report.executiveSummary).toContain("No capabilities registered");
  });

  it("produces report with agent cards having capabilities", async () => {
    // Create agent card files
    const cardsDir = join(dir, "cards");
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, "agent1.json"), JSON.stringify({
      id: "agent1", capabilities: ["code-review", "github.integration"], description: "Code review agent",
    }));
    writeFileSync(join(cardsDir, "agent2.json"), JSON.stringify({
      id: "agent2", capabilities: ["code-review", "workflow.planning"], description: "Planning agent",
    }));

    const { CapabilityEvolutionReporter } = await import("../../src/adaptation/capability-evolution-reporter.js");
    const reporter = new CapabilityEvolutionReporter(
      cardsDir,
      { loadLatest: async () => null },
      { list: async () => [] },
      { query: async () => ({ records: [] }) },
      store,
    );
    const report = await reporter.generateReport();
    expect(report.totalCapabilities).toBe(3); // code-review, github.integration, workflow.planning
    expect(report.healthAnalysis).toHaveLength(3);
    // Without any resolution events or proposals, all capabilities classify as deprecated
    expect(report.lifecycleDistribution.deprecated).toBe(3);
  });

  it("includes gap, overlap, drift sections even when empty", async () => {
    const { CapabilityEvolutionReporter } = await import("../../src/adaptation/capability-evolution-reporter.js");
    const reporter = new CapabilityEvolutionReporter(
      join(dir, "cards"),
      { loadLatest: async () => null },
      { list: async () => [] },
      { query: async () => ({ records: [] }) },
      store,
    );
    const report = await reporter.generateReport();
    expect(report.gapAnalysis).toEqual([]);
    expect(report.overlapAnalysis).toEqual([]);
    expect(report.driftAnalysis).toEqual([]);
  });

  it("loads reflection reports for gap detection", async () => {
    const cardsDir = join(dir, "cards");
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, "a.json"), JSON.stringify({
      id: "a", capabilities: ["existing.cap"], description: "Test",
    }));

    // Create a reflection report with a capability_gap recommendation
    const reflectionDir = join(dir, "reflections");
    mkdirSync(reflectionDir, { recursive: true });
    writeFileSync(join(reflectionDir, "report-1.json"), JSON.stringify({
      generatedAt: "2026-06-20T00:00:00.000Z",
      recommendations: [
        {
          type: "capability_gap",
          confidence: 0.8,
          title: 'Address capability gap for "missing.cap"',
          evidence: ['"missing.cap" requested 5 times with zero candidates'],
          recommendedAction: "Register an agent for this capability",
        },
        {
          type: "routing_adjustment",
          confidence: 0.6,
          title: "Adjust routing weights for code-review",
          evidence: ["Routing efficiency below threshold"],
          recommendedAction: "Rebalance weights",
        },
      ],
    }));

    const { CapabilityEvolutionReporter } = await import("../../src/adaptation/capability-evolution-reporter.js");
    const reporter = new CapabilityEvolutionReporter(
      cardsDir,
      { loadLatest: async () => null },
      { list: async () => [] },
      { query: async () => ({ records: [] }) },
      store,
      reflectionDir, // pass the optional reflection directory
    );
    const report = await reporter.generateReport();
    // Should detect "missing.cap" as a gap from the reflection report
    const missingCapGap = report.gapAnalysis.find((g) => g.suggestedCapability === "missing.cap");
    expect(missingCapGap).toBeDefined();
    expect(missingCapGap!.signalStrength).toBeGreaterThanOrEqual(1);
    expect(missingCapGap!.confidence).toBe("low"); // only 1 signal (reflection only)
  });

  it("persists report to store", async () => {
    const cardsDir = join(dir, "cards");
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, "a.json"), JSON.stringify({
      id: "a", capabilities: ["test.cap"], description: "Test",
    }));

    const { CapabilityEvolutionReporter } = await import("../../src/adaptation/capability-evolution-reporter.js");
    const reporter = new CapabilityEvolutionReporter(
      cardsDir,
      { loadLatest: async () => null },
      { list: async () => [] },
      { query: async () => ({ records: [] }) },
      store,
    );
    await reporter.generateReport();
    const files = await store.list();
    expect(files.length).toBeGreaterThanOrEqual(1);
    const latest = await store.loadLatest();
    expect(latest).not.toBeNull();
  });
});
