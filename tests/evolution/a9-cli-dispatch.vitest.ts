import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("A9 CLI dispatch smoke — `alix governance evolution forecast`", () => {
  const realCwd = process.cwd();
  let dir: string;
  let log: typeof console.log;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "a9-cli-smoke-"));
    const sess = join(dir, ".alix", "sessions", "s1");
    mkdirSync(sess, { recursive: true });
    const event = {
      id: "smoke-1",
      seq: 1,
      version: 1,
      sessionId: "s1",
      timestamp: "2026-08-10T00:00:00.000Z",
      type: "capability.governance.proposal.submitted",
      actor: "operator",
      payload: {
        proposalId: "prop-smoke",
        candidate: { candidateId: "c-prop-smoke", target: { kind: "capability", id: "cap-1" }, riskClass: "high", evidenceIds: ["ev-1"] },
        signalIds: [],
        sourceVersion: null,
      },
    };
    writeFileSync(join(sess, "events.jsonl"), JSON.stringify(event) + "\n", "utf-8");
    process.chdir(dir);
    log = console.log;
    console.log = vi.fn();
  });

  afterAll(() => {
    console.log = log;
    process.chdir(realCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("dispatches forecast to runForecastCli and prints RISK_GATED_REVIEW", async () => {
    const { handleGovernanceCommand } = await import("../../src/cli/commands/governance.js");
    await handleGovernanceCommand(["evolution", "forecast", "--json"]);
    const calls = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join("\n");
    expect(calls).toContain("forecasts");
    expect(calls).toContain("RISK_GATED_REVIEW");
    expect(calls).toContain("prop-smoke");
  });
});
