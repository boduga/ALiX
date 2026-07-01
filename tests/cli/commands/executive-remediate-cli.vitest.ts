/**
 * P10.9.2b-T2 — Integration tests for `alix executive remediate`.
 *
 * Tests handleRemediateCommand() through ProposalStore-backed fixture proposals
 * in a temporary directory. Verifies validation errors, child proposal creation,
 * dry-run behavior, and JSON output.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { handleRemediateCommand } from "../../../src/cli/commands/executive-remediate-handler.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(
  overrides: Partial<AdaptationProposal> & { id: string },
): AdaptationProposal {
  const base: AdaptationProposal = {
    id: "",
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "approved",
    action: "create_improvement_issue",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "step-1",
      objectiveId: "obj-1",
      subsystem: "governance" as const,
    },
    payload: { source: "executive_bridge", requiresHumanSpecification: true },
    sourceRecommendationType: "executive_remediation",
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-test"],
    reason: "test executive proposal",
  };
  return { ...base, ...overrides };
}

function createTempDir(): string {
  const dir = join(tmpdir(), `remediate-cli-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProposal(dir: string, proposal: AdaptationProposal): void {
  writeFileSync(
    join(dir, `${proposal.id}.json`),
    JSON.stringify(proposal, null, 2),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleRemediateCommand", () => {
  let tempDir: string;
  let proposalsDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    proposalsDir = join(tempDir, ".alix", "adaptation", "proposals");
    mkdirSync(proposalsDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: Not found
  // -----------------------------------------------------------------------
  it("shows error when proposal does not exist", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand(["non-existent-id"]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some(
        (e) =>
          e.includes("NOT_FOUND") ||
          e.includes("not found") ||
          e.includes("Proposal not found"),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 2: Not remediable — pending status
  // -----------------------------------------------------------------------
  it("shows error when proposal status is not approved (pending)", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-pending", status: "pending" }),
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand(["prop-pending"]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some(
        (e) =>
          e.includes("NOT_APPROVED") || e.includes('status is "pending"'),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 3: Non-executive proposal
  // -----------------------------------------------------------------------
  it("shows error when proposal is not executive bridge", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({
        id: "prop-non-exec",
        sourceRecommendationType: "manual_recommendation",
        payload: { source: "cli" },
      }),
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand(["prop-non-exec"]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some(
        (e) =>
          e.includes("NOT_EXECUTIVE") ||
          e.includes("not an executive bridge"),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 4: Missing --action in flag mode
  // -----------------------------------------------------------------------
  it("shows error when --action is missing in flag mode", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-no-action" }),
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand([
        "prop-no-action",
        "--target",
        "test-target",
        "--reason",
        "a valid reason for testing remediation",
      ]),
    ).rejects.toThrow("process.exit");

    expect(errors.some((e) => e.includes("--action"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 5: Invalid --action
  // -----------------------------------------------------------------------
  it("shows error when --action is not supported by provider", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-bad-action" }),
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand([
        "prop-bad-action",
        "--action",
        "nonexistent_action",
        "--target",
        "test-target",
        "--reason",
        "a valid reason for testing remediation",
      ]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some(
        (e) =>
          e.includes("UNSUPPORTED_ACTION") ||
          (e.includes("Action") && e.includes("not supported")),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 6: Reserved payload key
  // -----------------------------------------------------------------------
  it("shows error when --payload contains reserved lineage field", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-reserved" }),
    );

    const payloadPath = join(tempDir, "bad-payload.json");
    writeFileSync(
      payloadPath,
      JSON.stringify({ parentProposalId: "evil-override" }),
      "utf-8",
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand([
        "prop-reserved",
        "--action",
        "governance_change",
        "--target",
        "gov-target",
        "--reason",
        "a valid reason for governance change",
        "--payload",
        payloadPath,
      ]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some((e) => e.includes("reserved lineage")),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 7: Successful non-interactive
  // -----------------------------------------------------------------------
  it("creates child proposal and prints success message", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-success" }),
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleRemediateCommand([
      "prop-success",
      "--action",
      "governance_change",
      "--target",
      "gov-target",
      "--reason",
      "a valid reason for governance change",
    ]);

    expect(logs.some((l) => l.includes("Created child proposal"))).toBe(true);

    // Child should be persisted on disk
    const files = readdirSync(proposalsDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(2); // parent + child
  });

  // -----------------------------------------------------------------------
  // Test 8: --dry-run
  // -----------------------------------------------------------------------
  it("does not write child proposal when --dry-run is passed", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-dry" }),
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleRemediateCommand([
      "prop-dry",
      "--action",
      "governance_change",
      "--target",
      "gov-target",
      "--reason",
      "a valid reason for governance change",
      "--dry-run",
    ]);

    // Should show preview
    expect(logs.some((l) => l.includes("Child proposal"))).toBe(true);
    expect(logs.some((l) => l.includes("Nothing written"))).toBe(true);

    // No new file should be written
    const files = readdirSync(proposalsDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1); // only parent
  });

  // -----------------------------------------------------------------------
  // Test 9: --json output
  // -----------------------------------------------------------------------
  it("outputs valid JSON with correct structure when --json is passed", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-json" }),
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleRemediateCommand([
      "prop-json",
      "--action",
      "governance_change",
      "--target",
      "gov-target",
      "--reason",
      "a valid reason for governance change",
      "--json",
    ]);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const raw = logs.join("\n");
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(raw);
    }).not.toThrow();

    expect(parsed.ok).toBe(true);
    expect(parsed.parentProposalId).toBe("prop-json");
    expect(parsed.childProposalId).toBeTruthy();
    expect(typeof parsed.childProposalId).toBe("string");
    expect(parsed.childAction).toBe("governance_change");
    expect(parsed.childReadiness).toBe("needs_approval");
  });

  // -----------------------------------------------------------------------
  // Test 10: Empty/too-short --reason
  // -----------------------------------------------------------------------
  it("shows validation error when --reason is too short", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-short-reason" }),
    );

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      handleRemediateCommand([
        "prop-short-reason",
        "--action",
        "governance_change",
        "--target",
        "gov-target",
        "--reason",
        "short",
      ]),
    ).rejects.toThrow("process.exit");

    expect(
      errors.some(
        (e) =>
          e.includes("SHORT_REASON") ||
          (e.includes("reason") && e.includes("10")),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 8: Issue target uses title, not id (regression guard)
  // -----------------------------------------------------------------------
  it("creates child proposal with issue target using title", async () => {
    writeProposal(
      proposalsDir,
      makeProposal({ id: "prop-issue-target" }),
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    await handleRemediateCommand([
      "prop-issue-target",
      "--action",
      "create_improvement_issue",
      "--target",
      "Fix workflow remediation gap",
      "--reason",
      "a valid reason for creating a github issue target",
    ]);

    // Find the saved child proposal file
    const files = readdirSync(proposalsDir).filter(f => f.endsWith(".json") && f !== "prop-issue-target.json");
    expect(files.length).toBeGreaterThan(0);

    const childPath = join(proposalsDir, files[0]);
    const child = JSON.parse(readFileSync(childPath, "utf-8"));

    expect(child.target.kind).toBe("issue");
    expect(child.target.title).toBe("Fix workflow remediation gap");
    expect(child.target.id).toBeUndefined();

    // Verify describeTarget output doesn't contain "undefined"
    const hasUndefined = logs.some(l => l.includes("undefined"));
    expect(hasUndefined).toBe(false);
  });
});
