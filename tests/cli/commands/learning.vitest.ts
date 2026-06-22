/**
 * P8.7 — learning CLI command tests.
 *
 * Exercises handleLearningCommand against real temp directories
 * (LearningStore, ProposalStore). The handler resolves .alix paths from
 * process.cwd(), so each test points cwd at a fresh mkdtemp directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearningCommand } from "../../../src/cli/commands/learning.js";
import { LearningStore } from "../../../src/learning/learning-store.js";
import type {
  CalibrationProfile,
  LearningSignal,
} from "../../../src/learning/learning-types.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// process.cwd override + output capture
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "learning-cli-"));
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

function output(): string {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

function errorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    id: "cp-1",
    subject: "Reduce confidence multiplier",
    outcome: "suggested",
    confidence: 0.85,
    reasons: ["overconfidence"],
    generatedAt: new Date().toISOString(),
    target: "recommendation_confidence_multiplier",
    targetName: "bucket_0.8_1.0",
    previousValue: 1.0,
    suggestedValue: 0.65,
    reason: "Observed overconfidence",
    evidenceRefs: ["ls-1"],
    sourceSignalIds: ["ls-1"],
    ...overrides,
  };
}

function makeSignal(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return {
    id: "ls-1",
    subject: "Overconfidence",
    outcome: "signal_detected",
    confidence: 0.85,
    reasons: [],
    generatedAt: new Date().toISOString(),
    sourceReportId: "acc-1",
    signalType: "overconfidence",
    strength: 0.35,
    summary: "Overconfident by 18%",
    evidenceRefs: [],
    ...overrides,
  };
}

async function seedStore(signals: LearningSignal[], profiles: CalibrationProfile[]): Promise<void> {
  const store = new LearningStore(join(tempRoot, ".alix", "learning"));
  for (const s of signals) await store.appendSignal(s);
  for (const p of profiles) await store.appendProfile(p);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

describe("learning report", () => {
  it("reports honest empty state when no signals exist", async () => {
    await handleLearningCommand(["report"]);
    expect(output()).toContain("No learning signals found");
    expect(output()).toContain("builders (P8.1–P8.4) are tested and ready");
  });

  it("renders signals and profiles by area", async () => {
    await seedStore(
      [makeSignal({ signalType: "overconfidence", summary: "Overconfident by 18%" })],
      [makeProfile({ targetName: "bucket_0.8_1.0", previousValue: 1.0, suggestedValue: 0.65 })],
    );

    await handleLearningCommand(["report"]);
    const out = output();
    expect(out).toContain("Recommendation Calibration");
    expect(out).toContain("overconfidence");
    expect(out).toContain("bucket_0.8_1.0 1 → 0.65");
  });

  it("filters by --target", async () => {
    await seedStore(
      [
        makeSignal({ id: "ls-1", signalType: "overconfidence", summary: "rec signal" }),
        makeSignal({ id: "ls-2", signalType: "risk_dimension_overfire", summary: "risk signal" }),
      ],
      [],
    );

    await handleLearningCommand(["report", "--target", "risk"]);
    const out = output();
    expect(out).toContain("risk signal");
    expect(out).not.toContain("rec signal");
  });

  it("produces valid JSON with --json", async () => {
    await seedStore([makeSignal()], [makeProfile()]);

    await handleLearningCommand(["report", "--json"]);
    const json = JSON.parse(output());
    expect(json.windowDays).toBe(30);
    expect(json.signals).toHaveLength(1);
    expect(json.profiles).toHaveLength(1);
    expect(json.proposalSummary.available).toBe(1);
  });

  it("rejects invalid --target", async () => {
    await expect(handleLearningCommand(["report", "--target", "bogus"])).rejects.toThrow();
    expect(errorOutput()).toContain("--target must be one of");
  });

  it("groups routing signals under Routing Calibration", async () => {
    await seedStore(
      [
        makeSignal({
          id: "ls-r1",
          signalType: "routing_quality_good",
          summary: "Claude good for planning",
        }),
      ],
      [],
    );
    await handleLearningCommand(["report"]);
    const out = output();
    expect(out).toContain("Routing Calibration");
    expect(out).toContain("Claude good for planning");
  });
});

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

describe("learning propose", () => {
  it("creates a pending proposal from stored profiles", async () => {
    await seedStore(
      [],
      [
        makeProfile({
          id: "cp-a",
          sourceSignalIds: ["ls-1"],
        }),
      ],
    );

    await handleLearningCommand(["propose", "--target", "recommendation"]);
    const out = output();
    expect(out).toContain("Learning proposal created");
    expect(out).toContain("status:      pending (requires human approval)");

    // Verify the proposal file was written
    const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
    const files = existsSync(proposalsDir)
      ? readdirSync(proposalsDir)
      : [];
    expect(files.length).toBe(1);
    const proposal: AdaptationProposal = JSON.parse(
      readFileSync(join(proposalsDir, files[0]), "utf-8"),
    );
    expect(proposal.action).toBe("learning_adjustment");
    expect(proposal.status).toBe("pending");
    expect(proposal.target).toMatchObject({ kind: "learning", area: "recommendation" });
    expect(proposal.provenance).toBe("manual");
  });

  it("--dry-run does NOT persist a proposal", async () => {
    await seedStore([], [makeProfile({ id: "cp-a" })]);

    await handleLearningCommand(["propose", "--target", "recommendation", "--dry-run"]);
    const out = output();
    expect(out).toContain("[dry-run]");
    expect(out).toContain("Would create learning proposal");

    const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
    expect(existsSync(proposalsDir)).toBe(false);
  });

  it("reports gracefully when no profiles available for area", async () => {
    // Seed profiles for a different area
    await seedStore(
      [],
      [makeProfile({ id: "cp-risk", target: "risk_dimension_weight" })],
    );

    await handleLearningCommand(["propose", "--target", "recommendation"]);
    expect(output()).toContain("No calibration profiles available for area");
  });

  it("requires --target", async () => {
    await expect(handleLearningCommand(["propose"])).rejects.toThrow();
    expect(errorOutput()).toContain("--target is required");
  });

  it("rejects invalid --target", async () => {
    await expect(
      handleLearningCommand(["propose", "--target", "bogus"]),
    ).rejects.toThrow();
    expect(errorOutput()).toContain("--target must be one of");
  });

  it("routes governance profiles to the governance area", async () => {
    await seedStore(
      [],
      [makeProfile({ id: "cp-gov", target: "governance_lens_weight", targetName: "historian" })],
    );
    await handleLearningCommand(["propose", "--target", "governance"]);
    expect(output()).toContain("Learning proposal created");

    const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
    const files = existsSync(proposalsDir)
      ? readdirSync(proposalsDir)
      : [];
    const proposal: AdaptationProposal = JSON.parse(
      readFileSync(join(proposalsDir, files[0]), "utf-8"),
    );
    expect(proposal.target).toMatchObject({ kind: "learning", area: "governance" });
  });
});

// ---------------------------------------------------------------------------
// unknown subcommand
// ---------------------------------------------------------------------------

describe("unknown subcommand", () => {
  it("prints usage and exits", async () => {
    await expect(handleLearningCommand(["bogus"])).rejects.toThrow();
    expect(errorOutput()).toContain("Unknown learning subcommand");
  });
});
