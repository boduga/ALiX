import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleAdaptationCommand } from "../../../src/cli/commands/adaptation.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

let tempRoot: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let exitCodes: (string | number | null | undefined)[];

function setCwd(): void { cwdSpy.mockReturnValue(tempRoot); }

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.map(String).join(" ")); });
  return { out: () => out, err: () => err };
}

const T = "2026-06-12T00:00:00.000Z"; // appliedAt boundary

async function seedAppliedProposal(id: string, sourceRecommendationType: string): Promise<AdaptationProposal> {
  const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
  const proposal: AdaptationProposal = {
    id,
    createdAt: "2026-06-11T00:00:00.000Z",
    status: "applied",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "x" },
    payload: { id: "x", name: "X", description: "d", version: "1.0.0", domains: ["general"], capabilities: ["c"], enabled: true },
    sourceRecommendationType,
    sourceConfidence: 0.9,
    evidenceFingerprints: [],
    reason: "test",
    appliedAt: T,
  };
  await store.save(proposal);
  return proposal;
}

let n = 0;
function evLine(type: string, ts: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, id: `${type}-${n++}`, type, timestamp: ts, fingerprint: `fp-${n}`, payload });
}

function seedEvidence(lines: string[]): void {
  const dir = join(tempRoot, ".alix", "security");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "evidence.jsonl"), lines.join("\n") + "\n");
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-eff-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  setCwd();
  exitCodes = [];
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    exitCodes.push(code);
    throw new Error(`__exit_${code}__`);
  });
});

afterEach(() => {
  cwdSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("alix adaptation effectiveness <id>", () => {
  it("assesses an applied proposal: prints report, persists JSON, records evidence, does NOT mutate proposal", async () => {
    await seedAppliedProposal("prop-keep", "capability_gap");
    seedEvidence([
      ...Array.from({ length: 5 }, () => evLine("capability_routed", "2026-06-10T00:00:00Z", { candidates: 0 })), // before: 5 unresolved
      ...Array.from({ length: 5 }, () => evLine("capability_routed", "2026-06-15T00:00:00Z", { candidates: 2 })),   // after: 0 unresolved
    ]);

    const console = captureConsole();
    await handleAdaptationCommand(["effectiveness", "prop-keep"]);

    // Report printed
    const out = console.out().join("\n");
    expect(out).toContain("prop-keep");
    expect(out).toContain("KEEP");
    expect(out).toContain("unresolvedCapabilities");

    // Report persisted
    const reportPath = join(tempRoot, ".alix", "adaptation", "effectiveness", "prop-keep.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.proposalId).toBe("prop-keep");
    expect(report.recommendation).toBe("keep");
    expect(report.primary.metric).toBe("unresolvedCapabilities");
    expect(report.metricsBefore.unresolvedCapabilities).toBe(5);
    expect(report.metricsAfter.unresolvedCapabilities).toBe(0);

    // adaptation_effectiveness evidence recorded
    const store = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
    const ev = await store.query({ type: "adaptation_effectiveness" });
    expect(ev.total).toBe(1);
    expect(ev.records[0].payload.proposalId).toBe("prop-keep");
    expect(ev.records[0].payload.recommendation).toBe("keep");

    // Proposal NOT mutated (still applied with the same appliedAt — assess is read-only)
    const proposalStore = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    const reloaded = await proposalStore.load("prop-keep");
    expect(reloaded!.status).toBe("applied");
    expect(reloaded!.appliedAt).toBe(T);
  });

  it("--all iterates every applied proposal and writes one report each", async () => {
    await seedAppliedProposal("p-a", "capability_gap");
    await seedAppliedProposal("p-b", "skill_revision");
    seedEvidence([
      evLine("merge_completed", "2026-06-10T00:00:00Z"),
      evLine("workflow_aborted", "2026-06-15T00:00:00Z"),
    ]);

    const console = captureConsole();
    await handleAdaptationCommand(["effectiveness", "--all"]);

    const effDir = join(tempRoot, ".alix", "adaptation", "effectiveness");
    const files = readdirSync(effDir).sort();
    expect(files).toEqual(["p-a.json", "p-b.json"]);
    expect(console.out().join("\n")).toContain("p-a");
    expect(console.out().join("\n")).toContain("p-b");
  });

  it("errors cleanly on an unknown proposal id", async () => {
    const console = captureConsole();
    let threw = false;
    try { await handleAdaptationCommand(["effectiveness", "nope"]); } catch (e) { threw = (e as Error).message === "__exit_1__"; }
    expect(threw).toBe(true);
    expect(console.err().join("\n")).toContain("not found: nope");
  });
});