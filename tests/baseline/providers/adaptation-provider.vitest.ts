import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AdaptationBaselineProvider } from "../../../src/baseline/providers/adaptation-provider.js";

describe("AdaptationBaselineProvider", () => {
  let provider: AdaptationBaselineProvider;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `adaptation-provider-${randomUUID()}`);
    mkdirSync(join(tempDir, ".alix", "adaptation", "proposals"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    provider = new AdaptationBaselineProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("subsystem returns 'adaptation'", () => {
    expect(provider.subsystem).toBe("adaptation");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  it("baseline reads fixture proposals from temp dir", async () => {
    const proposalsDir = join(tempDir, ".alix", "adaptation", "proposals");

    writeFileSync(join(proposalsDir, "prop-1.json"), JSON.stringify({ id: "p1", status: "applied" }));
    writeFileSync(join(proposalsDir, "prop-2.json"), JSON.stringify({ id: "p2", status: "applied" }));
    writeFileSync(join(proposalsDir, "prop-3.json"), JSON.stringify({ id: "p3", status: "approved" }));
    writeFileSync(join(proposalsDir, "prop-4.json"), JSON.stringify({ id: "p4", status: "pending" }));
    writeFileSync(join(proposalsDir, "prop-5.json"), JSON.stringify({ id: "p5", status: "rejected" }));

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    expect(data.proposalCount).toBe(5);
    expect(data.appliedCount).toBe(2);
    expect(data.approvedCount).toBe(1);
    expect(data.pendingCount).toBe(1);
    expect(data.rejectedCount).toBe(1);
    expect(data.failedCount).toBe(0);
  });

  it("missing directory returns 0 metrics", async () => {
    rmSync(join(tempDir, ".alix"), { recursive: true, force: true });

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    expect(data.proposalCount).toBe(0);
    expect(data.pendingCount).toBe(0);
    expect(data.approvedCount).toBe(0);
    expect(data.appliedCount).toBe(0);
    expect(data.rejectedCount).toBe(0);
    expect(data.failedCount).toBe(0);
  });

  it("baseline cached, current re-reads", async () => {
    const proposalsDir = join(tempDir, ".alix", "adaptation", "proposals");

    writeFileSync(join(proposalsDir, "prop-1.json"), JSON.stringify({ id: "p1", status: "applied" }));
    const baseline = await provider.captureBaseline();
    expect((baseline.data as Record<string, number>).proposalCount).toBe(1);

    writeFileSync(join(proposalsDir, "prop-2.json"), JSON.stringify({ id: "p2", status: "pending" }));

    const cached = await provider.captureBaseline();
    expect((cached.data as Record<string, number>).proposalCount).toBe(1);

    const current = await provider.captureCurrent();
    expect((current.data as Record<string, number>).proposalCount).toBe(2);
  });

  it("malformed proposal file degrades gracefully", async () => {
    const proposalsDir = join(tempDir, ".alix", "adaptation", "proposals");

    writeFileSync(join(proposalsDir, "good.json"), JSON.stringify({ id: "p1", status: "applied" }));
    writeFileSync(join(proposalsDir, "bad.json"), "not-json");

    await expect(provider.captureBaseline()).resolves.toBeDefined();
  });

  it("invariant: proposalCount === sum of all status counts", async () => {
    const proposalsDir = join(tempDir, ".alix", "adaptation", "proposals");

    writeFileSync(join(proposalsDir, "p1.json"), JSON.stringify({ id: "p1", status: "applied" }));
    writeFileSync(join(proposalsDir, "p2.json"), JSON.stringify({ id: "p2", status: "applied" }));
    writeFileSync(join(proposalsDir, "p3.json"), JSON.stringify({ id: "p3", status: "pending" }));
    writeFileSync(join(proposalsDir, "p4.json"), JSON.stringify({ id: "p4", status: "approved" }));
    writeFileSync(join(proposalsDir, "p5.json"), JSON.stringify({ id: "p5", status: "rejected" }));
    writeFileSync(join(proposalsDir, "p6.json"), JSON.stringify({ id: "p6", status: "failed" }));

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    const sum = data.pendingCount + data.approvedCount + data.appliedCount + data.rejectedCount + data.failedCount;
    expect(data.proposalCount).toBe(sum);
  });
});
