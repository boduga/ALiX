/**
 * P5.2c.5 — adaptation generate CLI tests.
 *
 * Exercises `alix adaptation generate` end-to-end against real temp
 * directories (ProposalStore, EffectivenessStore, EvidenceStore). Mirrors the
 * P5.2b CLI test style (mkdtemp + vi.spyOn(process, "cwd") + vi.spyOn(process, "exit")).
 *
 * Architectural assertions:
 *   - Generator-only subcommand: NEVER approves, NEVER applies, NEVER mutates
 *     agent cards or skill files. Tests verify these invariants by checking
 *     store contents and that no agent-card / skill files appear on disk.
 *   - All generated proposals must have provenance="auto" and status="pending".
 *   - There is no --approve and no --apply flag wired to this subcommand
 *     (grep-sentinel on the source file).
 *
 * Coverage:
 *   (a) --reflection on a valid report with one high-confidence capability_gap
 *       → one pending auto proposal + one adaptation_proposed evidence; no
 *       agent-card file written; no proposal with status != pending.
 *   (b) Zero source flags → usage error + exit 1.
 *   (c) Two source flags → usage error + exit 1.
 *   (d) --effectiveness <id> on a revert report → one create_improvement_issue
 *       proposal with the verbatim reason.
 *   (e) --all-effectiveness iterates; keep/investigate/revert+insufficient
 *       produce zero proposals; only revert+sufficient produces one.
 *   (f) --min-confidence 0.95 skips a 0.92 capability_gap recommendation.
 *   (g) No --approve/--apply flag exists (file-text grep sentinel).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync as readFileSyncRaw } from "node:fs";
import { handleAdaptationCommand } from "../../../src/cli/commands/adaptation.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { EffectivenessStore } from "../../../src/adaptation/effectiveness-store.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";
import type { ReflectionReport } from "../../../src/reflection/reflection-types.js";
import type { ProposalEffectivenessReport } from "../../../src/adaptation/effectiveness-types.js";

// ---------------------------------------------------------------------------
// process.cwd + process.exit mocks
// ---------------------------------------------------------------------------

let tempRoot: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let exitCodes: (string | number | null | undefined)[];

function setCwd(): void {
  cwdSpy.mockReturnValue(tempRoot);
}

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.map(String).join(" "));
  });
  return { out: () => out, err: () => err };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-gen-cli-"));
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReflectionReport(
  recommendations: ReflectionReport["recommendations"],
): ReflectionReport {
  return {
    generatedAt: "2026-06-19T00:00:00.000Z",
    observations: [],
    recommendations,
    metrics: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 0,
      reviewApprovalRate: 1,
    },
    summary: {
      totalObservations: 0,
      totalRecommendations: recommendations.length,
      highSeverityCount: 0,
    },
  };
}

function writeReportFile(name: string, report: ReflectionReport): string {
  const path = join(tempRoot, name);
  writeFileSync(path, JSON.stringify(report), "utf-8");
  return path;
}

function makeEffectivenessReport(
  overrides: Partial<ProposalEffectivenessReport> = {},
): ProposalEffectivenessReport {
  return {
    proposalId: "prop-test-1",
    proposalCreatedAt: "2026-06-18T00:00:00.000Z",
    windowDays: 7,
    recommendation: "keep",
    dataSufficient: true,
    metrics: [],
    reason: "primary metric stable over window",
    primary: null,
    ...overrides,
  } as unknown as ProposalEffectivenessReport;
}

/** Seed an applied source proposal so the effectiveness path can find it. */
async function seedAppliedSourceProposal(id: string): Promise<void> {
  const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
  const proposal: AdaptationProposal = {
    id,
    createdAt: "2026-06-10T00:00:00.000Z",
    status: "applied",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "code-review" },
    payload: { id: "code-review", name: "CR", description: "d", version: "1.0.0", domains: ["general"], capabilities: ["c"], enabled: true },
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.9,
    evidenceFingerprints: ["src-ev-1"],
    reason: "source proposal",
    appliedAt: "2026-06-12T00:00:00.000Z",
  };
  await store.save(proposal);
}

async function writeEffectivenessReport(report: ProposalEffectivenessReport): Promise<void> {
  const dir = join(tempRoot, ".alix", "adaptation", "effectiveness");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${report.proposalId}.json`), JSON.stringify(report, null, 2), "utf-8");
}

function listAllProposals(): Promise<AdaptationProposal[]> {
  const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
  return store.list();
}

// ---------------------------------------------------------------------------
// (g) Architectural sentinel: no --approve / --apply flag wired to `generate`.
// ---------------------------------------------------------------------------

describe("alix adaptation generate — architectural sentinel", () => {
  it("the `generate` subcommand source path defines no --approve and no --apply flag", () => {
    // Read the source file as text and assert that within the runGenerate
    // function there is no `--approve` or `--apply` reference. This is a
    // file-text check (not runtime), so it cannot be silenced by renaming
    // a variable.
    //
    // We resolve via `import.meta.url` (no `process.cwd()` dependency) so
    // the test is robust to the cwd spy used in surrounding tests.
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const here = fileURLToPath(import.meta.url);
    // tests/cli/commands/adaptation-generate.vitest.ts lives three dirs
    // deep under the repo root: tests/cli/commands/ → 4x `..` lands at root.
    const cliPath = join(
      here,
      "..",
      "..",
      "..",
      "..",
      "src",
      "cli",
      "commands",
      "adaptation.ts",
    );
    const src = readFileSyncRaw(cliPath, "utf-8");

    // Locate the runGenerate function body. We look for `function runGenerate`
    // through the closing brace at the same indentation level. For
    // resilience we extract from the marker to the next `function ` or
    // top-level construct; we also tolerate the case where the function
    // does not yet exist (test should still pass because there will be no
    // --approve/--apply inside the empty marker span).
    const fnIdx = src.indexOf("function runGenerate");
    expect(fnIdx).toBeGreaterThan(-1);

    // Take a generous slice from runGenerate declaration to end-of-file,
    // since runGenerate is the last function added to this CLI in P5.2c.5.
    const slice = src.slice(fnIdx);

    // Token-level grep: no `--approve` or `--apply` flag references.
    expect(slice).not.toMatch(/--approve\b/);
    expect(slice).not.toMatch(/--apply\b/);
  });
});

// ---------------------------------------------------------------------------
// (a) --reflection flow: produces one pending auto proposal + evidence.
// ---------------------------------------------------------------------------

describe("alix adaptation generate --reflection <path>", () => {
  it("creates one pending provenance=auto proposal and one adaptation_proposed evidence; no agent-card or skill file written; no proposal mutated to approved/applied", async () => {
    const report = makeReflectionReport([
      {
        type: "capability_gap",
        confidence: 0.9,
        title: "missing capability",
        evidence: ["ev-1"],
        recommendedAction: "create agent card",
      },
    ]);
    const reportPath = writeReportFile("report.json", report);

    const console = captureConsole();
    await handleAdaptationCommand(["generate", "--reflection", reportPath]);

    // Proposal created
    const proposals = await listAllProposals();
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.status).toBe("pending");
    expect(p.provenance).toBe("auto");
    expect(p.sourceRecommendationType).toBe("capability_gap");
    expect(p.sourceConfidence).toBe(0.9);

    // Evidence recorded
    const evStore = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
    const ev = await evStore.query({ type: "adaptation_proposed" });
    expect(ev.total).toBe(1);
    expect(ev.records[0]!.payload).toMatchObject({
      proposalId: p.id,
      action: p.action,
      sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.9,
      provenance: "auto",
    });

    // No agent-card file or skill file written
    expect(existsSync(join(tempRoot, ".alix", "cards", "agents", `${p.target}.json`))).toBe(false);
    // broader: nothing in the agent-cards dir at all
    const cardsDir = join(tempRoot, ".alix", "cards", "agents");
    if (existsSync(cardsDir)) {
      const { readdirSync } = await import("node:fs");
      expect(readdirSync(cardsDir)).toEqual([]);
    }
    const skillsDir = join(tempRoot, ".alix", "skills", "workflow");
    if (existsSync(skillsDir)) {
      const { readdirSync } = await import("node:fs");
      expect(readdirSync(skillsDir)).toEqual([]);
    }

    // No proposal with status != "pending"
    for (const x of proposals) {
      expect(x.status).toBe("pending");
    }

    // Output contains the standard summary line
    const out = console.out().join("\n");
    expect(out).toMatch(/Generated: 1 proposal/);
  });

  it("respects --min-confidence 0.95 and skips a 0.92 capability_gap recommendation", async () => {
    const report = makeReflectionReport([
      {
        type: "capability_gap",
        confidence: 0.92,
        title: "borderline",
        evidence: ["ev-1"],
        recommendedAction: "create agent card",
      },
    ]);
    const reportPath = writeReportFile("report.json", report);

    const console = captureConsole();
    await handleAdaptationCommand([
      "generate",
      "--reflection",
      reportPath,
      "--min-confidence",
      "0.95",
    ]);

    // No proposal persisted
    const proposals = await listAllProposals();
    expect(proposals).toEqual([]);

    // No evidence emitted (skip path emits nothing)
    const evStore = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
    const ev = await evStore.query({ type: "adaptation_proposed" });
    expect(ev.total).toBe(0);

    // Output shows the skip
    const out = console.out().join("\n");
    expect(out).toMatch(/Generated: 0 proposal/);
    expect(out).toMatch(/Skipped:.*1/);
  });
});

// ---------------------------------------------------------------------------
// (b) Zero source flags → usage error + exit 1.
// ---------------------------------------------------------------------------

describe("alix adaptation generate — invalid flag combinations", () => {
  it("zero source flags → usage error + exit 1", async () => {
    const console = captureConsole();
    let threw = false;
    try {
      await handleAdaptationCommand(["generate"]);
    } catch (e) {
      threw = (e as Error).message === "__exit_1__";
    }
    expect(threw).toBe(true);
    expect(exitCodes).toEqual([1]);
    const err = console.err().join("\n");
    expect(err).toMatch(/Usage:/);
    expect(err).toMatch(/--reflection|--effectiveness|--all-effectiveness/);

    // No proposal was written
    const proposals = await listAllProposals();
    expect(proposals).toEqual([]);
  });

  it("two source flags → usage error + exit 1", async () => {
    // Pre-create one effectiveness report so the second flag has something
    // to point at. (Even with both flags provided the parser must reject
    // before it ever reads them.)
    await writeEffectivenessReport(makeEffectivenessReport({ proposalId: "p1" }));

    const console = captureConsole();
    let threw = false;
    try {
      await handleAdaptationCommand([
        "generate",
        "--reflection",
        "report.json",
        "--all-effectiveness",
      ]);
    } catch (e) {
      threw = (e as Error).message === "__exit_1__";
    }
    expect(threw).toBe(true);
    expect(exitCodes).toEqual([1]);
    expect(console.err().join("\n")).toMatch(/Usage:/);

    // No proposals created
    const proposals = await listAllProposals();
    expect(proposals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) --effectiveness <id> on a revert report.
// ---------------------------------------------------------------------------

describe("alix adaptation generate --effectiveness <id>", () => {
  it("produces one create_improvement_issue proposal with the verbatim reason on a revert report", async () => {
    await seedAppliedSourceProposal("prop-source-1");
    const report = makeEffectivenessReport({
      proposalId: "prop-source-1",
      assessedAt: "2026-06-19T00:00:00.000Z",
      recommendation: "revert",
      dataSufficient: true,
    });
    await writeEffectivenessReport(report);

    const console = captureConsole();
    await handleAdaptationCommand(["generate", "--effectiveness", "prop-source-1"]);

    const proposals = await listAllProposals();
    // 1 source proposal + 1 generated proposal
    const generated = proposals.filter((p) => p.provenance === "auto");
    expect(generated).toHaveLength(1);

    const p = generated[0]!;
    expect(p.status).toBe("pending");
    expect(p.provenance).toBe("auto");
    expect(p.action).toBe("create_improvement_issue");
    expect(p.target.kind).toBe("issue");

    // Verbatim reason: the auto-generator's exact format.
    const expectedReason =
      "Effectiveness report recommends REVERT for proposal prop-source-1, " +
      "but executable revert is out of scope. " +
      "This proposal asks a human to investigate and create a manual remediation path.";
    expect(p.reason).toBe(expectedReason);

    // No status mutation on source proposal
    const source = proposals.find((x) => x.id === "prop-source-1");
    expect(source?.status).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// (e) --all-effectiveness iterates; only revert+sufficient produces a proposal.
// ---------------------------------------------------------------------------

describe("alix adaptation generate --all-effectiveness", () => {
  it("iterates every report; only revert+sufficient produces a proposal; others are skipped", async () => {
    await seedAppliedSourceProposal("p-keep");
    await seedAppliedSourceProposal("p-investigate");
    await seedAppliedSourceProposal("p-revert-insufficient");
    await seedAppliedSourceProposal("p-revert-sufficient");

    // keep → no proposal
    await writeEffectivenessReport(
      makeEffectivenessReport({
        proposalId: "p-keep",
        recommendation: "keep",
        dataSufficient: true,
      }),
    );
    // investigate → no proposal
    await writeEffectivenessReport(
      makeEffectivenessReport({
        proposalId: "p-investigate",
        recommendation: "investigate",
        dataSufficient: true,
      }),
    );
    // revert with insufficient data → no proposal
    await writeEffectivenessReport(
      makeEffectivenessReport({
        proposalId: "p-revert-insufficient",
        recommendation: "revert",
        dataSufficient: false,
      }),
    );
    // revert with sufficient data → one proposal
    await writeEffectivenessReport(
      makeEffectivenessReport({
        proposalId: "p-revert-sufficient",
        recommendation: "revert",
        dataSufficient: true,
      }),
    );

    const console = captureConsole();
    await handleAdaptationCommand(["generate", "--all-effectiveness"]);

    const proposals = await listAllProposals();
    const generated = proposals.filter((p) => p.provenance === "auto");
    expect(generated).toHaveLength(1);
    expect(generated[0]!.action).toBe("create_improvement_issue");
    expect(generated[0]!.payload).toMatchObject({
      sourceProposalId: "p-revert-sufficient",
    });

    // All four source proposals remain status="applied"
    for (const id of ["p-keep", "p-investigate", "p-revert-insufficient", "p-revert-sufficient"]) {
      const s = proposals.find((p) => p.id === id);
      expect(s?.status).toBe("applied");
    }

    // Summary mentions generated + skipped
    const out = console.out().join("\n");
    expect(out).toMatch(/Generated: 1 proposal/);
    expect(out).toMatch(/Skipped:.*3/);
  });
});
