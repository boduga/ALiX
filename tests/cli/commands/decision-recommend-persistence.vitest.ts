/**
 * P7.5p.1b — CLI integration test: runRecommend persists ApprovalRecommendation.
 *
 * Contract (per plan Task 2):
 *   1. JSONL file exists at `.alix/recommendations/recommendations.jsonl` after runRecommend.
 *   2. The file contains exactly one valid line.
 *   3. The line is parseable as an ApprovalRecommendation.
 *
 * The test exercises the CLI entry point (`handleDecisionCommand`) with a stub args
 * array, and points `process.cwd` at a temp dir so the store resolves the right path.
 *
 * The CLI builds a real DecisionContext from ProposalStore/EvidenceStore/etc. so we
 * seed a minimal proposal + supporting evidence to allow the recommendation flow
 * to complete without throwing. Even if engine internals short-circuit (e.g.,
 * low-confidence context), the write hook must still run — the store write is
 * unconditional once `recEngine.recommend` returns an `ApprovalRecommendation`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDecisionCommand } from "../../../src/cli/commands/decision.js";

// ---------------------------------------------------------------------------
// process.cwd override + output capture
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "decision-recommend-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Minimal proposal seed — runRecommend needs at least one pending proposal.
// We bypass real proposal creation flows (which would require LLM provider keys)
// by writing a minimal JSON file the ProposalStore can load.
// ---------------------------------------------------------------------------

function seedMinimalProposal(id: string): void {
  const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
  mkdirSync(proposalsDir, { recursive: true });

  const proposal: Record<string, unknown> = {
    id,
    action: "revert_proposal",
    target: { kind: "revert", sourceProposalId: "prop-original" },
    reason: "minimal test proposal",
    status: "pending",
    createdAt: new Date().toISOString(),
    evidenceFingerprints: [],
    payload: {},
    sourceRecommendationType: "test-fixture",
    sourceConfidence: 0.5,
  };
  writeFileSync(join(proposalsDir, `${id}.json`), JSON.stringify(proposal));
}

describe("decision recommend persists ApprovalRecommendation (P7.5p.1b)", () => {
  it("writes one valid line to .alix/recommendations/recommendations.jsonl", async () => {
    const proposalId = "prop-test-1";
    seedMinimalProposal(proposalId);

    await handleDecisionCommand(["recommend", proposalId, "--json"]);

    const path = join(tempRoot, ".alix", "recommendations", "recommendations.jsonl");
    expect(existsSync(path)).toBe(true);

    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBeTruthy();
    expect(typeof parsed.confidence).toBe("number");
    expect(parsed.proposalId).toBe(proposalId);
    expect(["approve", "reject", "defer", "investigate"]).toContain(parsed.recommendation);
  });
});
