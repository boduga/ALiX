import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleClaimVerify,
  CLAIM_VERIFY_TOOL,
} from "../../src/tools/claim-verification-tool.js";
import {
  DEFAULT_DECISION_CONFIG,
  ProjectionRejectedError,
  JournalWriteError,
  JEV_CLAIM_QUESTION_ID,
  createDecisionJournalStore,
  createDefaultRegistry,
  registerJevEngine,
  createExperimentProjectionStore,
  MAX_CLAIM_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  type DecisionConfig,
  type DecisionJournalRecord,
  type JevTransport,
} from "../../src/decision/index.js";

const SUPPORTED = "Water boils at 100 degrees Celsius at sea level.";
const EVIDENCE = [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }];

function configWith(mode: "baseline" | "shadow" | "active"): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    remote: { jev: { enabled: mode !== "baseline" } },
    claimVerification: {
      engine: mode === "baseline" ? "local" : "jev",
      fallback: "local",
      thresholdProfile: mode === "baseline" ? "claim-verification/local/v1" : "claim-verification/jev/v1",
      mode,
    },
  };
}

function okTransport(choice: string): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice } },
  });
}

function parseOutput(result: { kind: string; output?: string }): Record<string, unknown> {
  assert.equal(result.kind, "success");
  return JSON.parse(result.output ?? "{}") as Record<string, unknown>;
}

describe("verify.claim tool", () => {
  let cwd: string;
  let storeDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cv-tool-"));
    storeDir = join(cwd, "home-alix");
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("exposes the documented tool name", () => {
    assert.equal(CLAIM_VERIFY_TOOL, "verify.claim");
  });

  it("rejects a missing claim naming the requirement", async () => {
    const result = await handleClaimVerify(
      { evidence: EVIDENCE },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /non-empty string claim/);
  });

  it("rejects an over-long claim naming the limit, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: "x".repeat(MAX_CLAIM_CHARS + 1), evidence: [] },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_CLAIM_CHARS)));
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("rejects more than MAX_EVIDENCE_ITEMS items", async () => {
    const evidence = Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, () => ({ excerpt: "e" }));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_EVIDENCE_ITEMS)));
  });

  it("rejects an over-long excerpt naming the limit", async () => {
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: [{ excerpt: "x".repeat(MAX_EXCERPT_CHARS + 1) }] },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_EXCERPT_CHARS)));
  });

  it("rejects a whitespace-only excerpt with the non-empty message, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: [{ excerpt: "   " }] },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /non-empty excerpt string/);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("rejects evidence that is not an array, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: "not-an-array" },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /evidence must be an array/);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("rejects a non-object evidence item, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: [42] },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /each evidence item must be \{ source\?, excerpt \}/);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("rejects a non-string excerpt, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: [{ excerpt: 42 }] },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /non-empty excerpt string/);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("baseline mode: local verdict, no decisionId, no journal, no experiment record", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("baseline"), registry: createDefaultRegistry(), journal, experimentStoreDir: storeDir },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.equal(payload.authority, "none");
    assert.equal(payload.decisionId, undefined);
    assert.equal(payload.warning, undefined);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("shadow mode: payload carries only {verdict, engine, decisionId, authority}", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("shadow"), registry, journal, experimentStoreDir: storeDir, apiKey: "k" },
    );
    const payload = parseOutput(result);
    assert.deepEqual(
      Object.keys(payload).sort(),
      ["authority", "decisionId", "engine", "verdict"],
    );
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.equal(payload.authority, "none");
    assert.ok(typeof payload.decisionId === "string");
    assert.equal(JSON.stringify(payload).includes("agree"), false);
    assert.equal(journal.readAll().length, 2);
    const experiments = createExperimentProjectionStore(storeDir);
    const stored = await experiments.readByHash(
      journal.readAll()[0].projectionHash,
    );
    assert.equal(stored?.claim, SUPPORTED);
  });

  it("boundary rejection: local verdict + warning, no journal, no experiment record", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: configWith("shadow"),
        registry: createDefaultRegistry(),
        journal,
        experimentStoreDir: storeDir,
        project: () => {
          throw new ProjectionRejectedError("secret-bearing evidence");
        },
      },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.match(String(payload.warning), /remote verification skipped: secret-bearing evidence/);
    assert.equal(payload.decisionId, undefined);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("unregistered non-jev engine: catch arm degrades to local + warning, no journal, no experiment record", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const config = configWith("shadow");
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: {
          ...config,
          claimVerification: { ...config.claimVerification, engine: "ghost-engine" },
        },
        registry: createDefaultRegistry(),
        journal,
        experimentStoreDir: storeDir,
      },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.equal(payload.authority, "none");
    assert.match(String(payload.warning), /remote engine unavailable/);
    assert.equal(payload.decisionId, undefined);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("journal write failure: verdict still returned with a warning", async () => {
    const journal = {
      append() {
        throw new JournalWriteError("disk full");
      },
      readAll: () => [] as DecisionJournalRecord[],
      findByDecision: () => [] as DecisionJournalRecord[],
      findByExecution: () => [] as DecisionJournalRecord[],
      findByProjectionHash: () => [] as DecisionJournalRecord[],
    };
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("shadow"), registry, journal, experimentStoreDir: storeDir, apiKey: "k" },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.match(String(payload.warning), /journal write failed/);
  });

  it("experiment store write failure: verdict + decisionId still returned with a warning", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: configWith("shadow"),
        registry,
        journal,
        experimentStoreDir: storeDir,
        apiKey: "k",
        saveExperiment: async () => {
          throw new Error("disk full");
        },
      },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.ok(typeof payload.decisionId === "string");
    assert.match(String(payload.warning), /experiment projection write failed: disk full/);
  });

  it("remote outage: tool stays available with the local verdict", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      transport: async () => {
        throw new Error("network down");
      },
    });
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: configWith("shadow"),
        registry,
        journal: createDecisionJournalStore(join(cwd, ".alix", "decisions")),
        experimentStoreDir: storeDir,
        apiKey: "k",
      },
    );
    assert.equal(parseOutput(result).verdict, "supported");
  });
});
