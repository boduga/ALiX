import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SecurityBaselineProvider } from "../../../src/baseline/providers/security-provider.js";

describe("SecurityBaselineProvider", () => {
  let provider: SecurityBaselineProvider;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `security-provider-${randomUUID()}`);
    mkdirSync(join(tempDir, ".alix", "policies"), { recursive: true });
    mkdirSync(join(tempDir, ".alix", "security"), { recursive: true });
    mkdirSync(join(tempDir, ".alix", "credentials"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    provider = new SecurityBaselineProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("subsystem returns 'security'", () => {
    expect(provider.subsystem).toBe("security");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  // -----------------------------------------------------------------------
  // Baseline fixture files
  // -----------------------------------------------------------------------

  it("baseline reads fixture files from temp dir", async () => {
    // Write policies
    writeFileSync(join(tempDir, ".alix", "policies", "access.json"), JSON.stringify({ name: "access" }));
    writeFileSync(join(tempDir, ".alix", "policies", "audit.json"), JSON.stringify({ name: "audit" }));
    writeFileSync(join(tempDir, ".alix", "policies", "rbac.json"), JSON.stringify({ name: "rbac" }));

    // Write evidence JSONL with 3 records forming a valid chain
    const evidenceContent = [
      JSON.stringify({ fingerprint: "a1", previousFingerprint: null, action: "login" }),
      JSON.stringify({ fingerprint: "b2", previousFingerprint: "a1", action: "read" }),
      JSON.stringify({ fingerprint: "c3", previousFingerprint: "b2", action: "write" }),
    ].join("\n");
    writeFileSync(join(tempDir, ".alix", "security", "evidence.jsonl"), evidenceContent);

    // Write credentials
    writeFileSync(join(tempDir, ".alix", "credentials", "key.json"), JSON.stringify({ id: "k1" }));
    writeFileSync(join(tempDir, ".alix", "credentials", "cert.pem"), "cert-data");

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    expect(data.policyCount).toBe(3);
    expect(data.evidenceRecordCount).toBe(3);
    expect(data.invalidEvidenceRecords).toBe(0);
    expect(data.credentialFiles).toBe(2);
    expect(data.chainIntegrityOk).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Missing directory
  // -----------------------------------------------------------------------

  it("missing directory returns 0 metrics", async () => {
    // Remove all .alix subdirectories that would exist from beforeEach
    rmSync(join(tempDir, ".alix"), { recursive: true, force: true });

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    expect(data.policyCount).toBe(0);
    expect(data.evidenceRecordCount).toBe(0);
    expect(data.invalidEvidenceRecords).toBe(0);
    expect(data.credentialFiles).toBe(0);
    expect(data.chainIntegrityOk).toBe(1); // no records → integrity holds
  });

  // -----------------------------------------------------------------------
  // Baseline cached, current re-reads
  // -----------------------------------------------------------------------

  it("baseline cached, current re-reads", async () => {
    // Initial baseline with no files
    const baseline = await provider.captureBaseline();
    const baselineData = baseline.data as Record<string, number>;
    expect(baselineData.policyCount).toBe(0);

    // Add a policy file
    writeFileSync(join(tempDir, ".alix", "policies", "new.json"), JSON.stringify({ name: "new" }));

    // Baseline should still return 0 (cached)
    const baselineAgain = await provider.captureBaseline();
    expect((baselineAgain.data as Record<string, number>).policyCount).toBe(0);

    // Current should reflect the change
    const current = await provider.captureCurrent();
    expect((current.data as Record<string, number>).policyCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Evidence chain integrity detection
  // -----------------------------------------------------------------------

  it("evidence chain integrity detection", async () => {
    // Valid chain
    const validContent = [
      JSON.stringify({ fingerprint: "x1", previousFingerprint: null }),
      JSON.stringify({ fingerprint: "y2", previousFingerprint: "x1" }),
    ].join("\n");
    writeFileSync(join(tempDir, ".alix", "security", "evidence.jsonl"), validContent);

    const artifactValid = await provider.captureBaseline();
    expect((artifactValid.data as Record<string, number>).chainIntegrityOk).toBe(1);

    // Break the cache so we re-capture on next call
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    provider = new SecurityBaselineProvider();

    // Broken chain — previousFingerprint doesn't match
    const brokenContent = [
      JSON.stringify({ fingerprint: "x1", previousFingerprint: null }),
      JSON.stringify({ fingerprint: "y2", previousFingerprint: "z9" }), // doesn't match x1
    ].join("\n");
    writeFileSync(join(tempDir, ".alix", "security", "evidence.jsonl"), brokenContent);

    const artifactBroken = await provider.captureBaseline();
    expect((artifactBroken.data as Record<string, number>).chainIntegrityOk).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Malformed evidence JSONL
  // -----------------------------------------------------------------------

  it("malformed evidence JSONL: chainIntegrityOk=0, invalidEvidenceRecords incremented, provider succeeds", async () => {
    const mixedContent = [
      JSON.stringify({ fingerprint: "a1", previousFingerprint: null }),
      "this-is-not-json",
      JSON.stringify({ fingerprint: "b2", previousFingerprint: "a1" }),
    ].join("\n");
    writeFileSync(join(tempDir, ".alix", "security", "evidence.jsonl"), mixedContent);

    await expect(provider.captureBaseline()).resolves.toBeDefined();

    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;

    expect(data.evidenceRecordCount).toBe(3);
    expect(data.invalidEvidenceRecords).toBe(1);
    expect(data.chainIntegrityOk).toBe(0);
  });
});
