import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DECISION_CONFIG,
  createDecisionJournalStore,
  createOutcomeLabelStore,
  createOutcomeLabel,
  recordDecision,
} from "../../src/decision/index.js";
import {
  JEV_KEY_PROVIDER_ID,
  JevOperatorError,
  buildStatus,
  deriveProfile,
  exportDataset,
  labelDecision,
  listProfiles,
  loadDecisionConfig,
  parseDecisionType,
  promoteProfileById,
  reliabilityReport,
  resolveJevPaths,
  rollbackProfiles,
  shippedProfiles,
} from "../../src/cli/commands/jev/ops.js";
import {
  buildFixtures,
  loadFixtures,
  makeExecutor,
  runReplay,
} from "../../src/cli/commands/jev/replay-ops.js";
import { dispatchJevCommand } from "../../src/cli/commands/jev/main.js";
import { _setUserConfigPathOverride } from "../../src/cli/helpers/api-keys.js";
import { _setHomedirOverride } from "../../src/config/loader.js";

let cwd: string;
let paths: ReturnType<typeof resolveJevPaths>;
/** A models block so model-tier fixtures get real canonical candidates. */
const MODELS = {
  default: { provider: "openai", name: "gpt-4o" },
  coding: { provider: "anthropic", name: "claude-sonnet-4" },
  thinking: { provider: "deepseek", name: "deepseek-reasoner" },
  critic: { provider: "openai", name: "gpt-4o-mini" },
  fast: { provider: "groq", name: "llama-3.1-8b-instant" },
  tiny: { provider: "ollama", name: "llama3.2:1b" },
  image: { provider: "google", name: "gemini-2.5-flash-image" },
} as const;

before(() => {
  cwd = mkdtempSync(join(tmpdir(), "alix-jev-cli-"));
  paths = resolveJevPaths(cwd);
  // Hermetic: `buildStatus` reads the user config, so point the loader at a
  // sandbox HOME instead of the developer's machine.
  _setHomedirOverride(join(cwd, "home"));
  _setUserConfigPathOverride(join(cwd, "home", ".config", "alix", "config.json"));
});
after(() => {
  _setHomedirOverride(undefined);
  _setUserConfigPathOverride(undefined);
  rmSync(cwd, { recursive: true, force: true });
});

/** Hermetic user config so key lookups never touch the real one. */
function withUserConfig(apiKeys: Record<string, string>): void {
  const path = join(cwd, "user-config.json");
  writeFileSync(path, JSON.stringify({ version: 1, apiKeys }), "utf8");
  _setUserConfigPathOverride(path);
}

/** Seed `count` labelled context-relevance decisions. */
function seed(count: number, correctFrom: number, target: ReturnType<typeof resolveJevPaths> = paths): void {
  const journal = createDecisionJournalStore(target.dir);
  for (let i = 0; i < count; i += 1) {
    const probability = 0.95 - i * 0.05;
    const record = recordDecision({
      decision: "context-relevance",
      engineId: "local",
      projectionHash: `sha256:seed-${i}`,
      outcome: { kind: "noul", probability },
      latencyMs: 2,
      remote: false,
      redactionApplied: false,
      now: 1_700_000_000_000 + i,
    });
    journal.append(record);
    void createOutcomeLabelStore(target.dir).append(
      createOutcomeLabel({
        decisionId: record.decisionId,
        decision: "context-relevance",
        label: i < correctFrom ? "correct" : "incorrect",
        ...(i < correctFrom ? {} : { errorType: "false_positive" as const }),
        observedAt: 1_700_000_001_000 + i,
      }),
    );
  }
}

describe("jev ops — status", () => {
  it("reports routes, disabled flags and the shipped defaults on an empty dir", async () => {
    const status = await buildStatus(paths);
    assert.equal(status.journalRecords, 0);
    assert.equal(status.labels, 0);
    assert.equal(status.remoteJevEnabled, false);
    assert.deepEqual(status.routes.map((route) => route.decision), [
      "claim-verification",
      "context-relevance",
      "model-tier",
      "risk-escalation",
    ]);
    assert.ok(status.routes.every((route) => route.enabled === false));
    assert.equal(status.shippedProfiles.length, 2);
    assert.ok(status.shippedProfiles.every((profile) => profile.status === "shadow"));
  });

  it("loads the canonical decision config and validates decision names", async () => {
    const config = await loadDecisionConfig(cwd);
    assert.equal(config.remote.jev.enabled, false);
    assert.equal(parseDecisionType("model-tier"), "model-tier");
    assert.throws(() => parseDecisionType("nope"), JevOperatorError);
  });

  it("shipped profiles exist only for the decision that seeds them", () => {
    assert.equal(shippedProfiles("context-relevance").length, 2);
    assert.deepEqual(shippedProfiles("claim-verification"), []);
  });
});

describe("jev ops — labels", () => {
  it("appends a label and flags an unknown decision id", async () => {
    const known = await labelDecision(paths, {
      decisionId: "does-not-exist",
      decision: "claim-verification",
      label: "correct",
    });
    assert.equal(known.knownDecisionId, false);
    const read = await createOutcomeLabelStore(paths.dir).readAll();
    assert.equal(read.labels.length, 1);
    assert.equal(read.labels[0].decisionId, "does-not-exist");
  });

  it("rejects an unknown label value", async () => {
    await assert.rejects(
      labelDecision(paths, {
        decisionId: "x",
        decision: "claim-verification",
        label: "maybe" as never,
      }),
      /unknown label/,
    );
  });
});

describe("jev ops — calibration", () => {
  before(() => {
    seed(10, 6);
  });

  it("exports a dataset with skip accounting", async () => {
    const dataset = await exportDataset(paths, { decision: "context-relevance" });
    assert.equal(dataset.samples.length, 10);
    assert.deepEqual(dataset.skipped, {
      unlabeled: 0,
      unknownLabel: 0,
      failureOutcome: 0,
      duplicateDecisionId: 0,
    });
    assert.equal(dataset.filters.decision, "context-relevance");
  });

  it("computes reliability and surfaces an operator error when there is nothing to calibrate", async () => {
    const report = await reliabilityReport(paths, {
      decision: "context-relevance",
      engineId: "local",
    });
    assert.equal(report.metric, "probability");
    assert.equal(report.sampleCount, 10);
    assert.ok(report.expectedCalibrationError >= 0);

    await assert.rejects(
      reliabilityReport(paths, { decision: "model-tier", engineId: "local" }),
      (error: unknown) => error instanceof JevOperatorError && /no samples/.test(error.message),
    );
  });
});

describe("jev ops — threshold profiles", () => {
  let profilePaths: ReturnType<typeof resolveJevPaths>;

  before(() => {
    profilePaths = resolveJevPaths(join(cwd, "profiles"));
    seed(10, 8, profilePaths);
  });

  it("derives a shadow profile with provenance and persists it", async () => {
    const derived = await deriveProfile(profilePaths, {
      decision: "context-relevance",
      engineId: "local",
      targetAccuracy: 0.8,
      id: "context-relevance/local/v2",
      datasetId: "fixture/seed",
      now: 1_800_000_000_000,
    });
    assert.equal(derived.status, "shadow");
    assert.equal(derived.provenance?.datasetId, "fixture/seed");
    assert.equal(derived.provenance?.sampleCount, 10);
    assert.ok(listProfiles(profilePaths).some((profile) => profile.id === "context-relevance/local/v2"));
  });

  it("refuses promotion without approval and for an uncalibrated profile", async () => {
    assert.throws(
      () => promoteProfileById(profilePaths, "context-relevance/local/v2", { approved: false }),
      /requires explicit approval/,
    );
    // The shipped seed has no provenance, so it can never be promoted.
    const shipped = shippedProfiles("context-relevance")[0];
    assert.throws(
      () => promoteProfileById(profilePaths, shipped.id, { approved: true }),
      /unknown profile/,
    );
  });

  it("promotes with approval, records the approver, and rolls back to the prior profile", async () => {
    const first = promoteProfileById(profilePaths, "context-relevance/local/v2", {
      approved: true,
      approvedBy: "operator-a",
      now: 1_800_000_001_000,
    });
    const v2 = first.find((profile) => profile.id === "context-relevance/local/v2");
    assert.equal(v2?.status, "active");
    assert.equal(v2?.approvedBy, "operator-a");

    // Promote a second version so there is something to roll back to.
    await deriveProfile(profilePaths, {
      decision: "context-relevance",
      engineId: "local",
      targetAccuracy: 0.5,
      id: "context-relevance/local/v3",
      datasetId: "fixture/seed",
    });
    promoteProfileById(profilePaths, "context-relevance/local/v3", {
      approved: true,
      now: 1_800_000_002_000,
    });

    const rolledBack = rollbackProfiles(
      profilePaths,
      { decision: "context-relevance", engineId: "local" },
      { now: 1_800_000_003_000 },
    );
    const active = rolledBack.filter(
      (profile) => profile.status === "active" && profile.engineId === "local",
    );
    assert.deepEqual(active.map((profile) => profile.id), ["context-relevance/local/v2"]);
  });
});

describe("jev replay ops — fixtures", () => {
  it("builds fixtures from every decision's corpus", () => {
    const claim = buildFixtures({ models: MODELS }, paths, "claim-verification");
    assert.ok(claim.length >= 6);
    assert.ok(claim.every((fixture) => fixture.decision === "claim-verification"));

    const relevance = buildFixtures({ models: MODELS }, paths, "context-relevance");
    assert.ok(relevance.length >= 4);

    const tier = buildFixtures({ models: MODELS }, paths, "model-tier");
    assert.ok(tier.length >= 4);
    // Canonical candidates come from the models block, not a DecisionConfig.
    assert.ok(tier.some((fixture) => (fixture.candidates?.length ?? 0) === 7));

    const risk = buildFixtures({ models: MODELS }, paths, "risk-escalation");
    assert.ok(risk.length >= 6);
    assert.ok(risk.every((fixture) => Array.isArray(fixture.candidates)));
  });

  it("lists fixtures and filters by decision", () => {
    assert.ok(loadFixtures(paths).length > 0);
    const risk = loadFixtures(paths, "risk-escalation");
    assert.ok(risk.every((fixture) => fixture.decision === "risk-escalation"));
  });

  it("refuses to replay before fixtures exist", async () => {
    const empty = resolveJevPaths(join(cwd, "empty"));
    await assert.rejects(
      runReplay(DEFAULT_DECISION_CONFIG, empty, { engineId: "local" }),
      /no fixtures/,
    );
  });
});

describe("jev replay ops — engines and results", () => {
  let replayPaths: ReturnType<typeof resolveJevPaths>;

  before(() => {
    replayPaths = resolveJevPaths(join(cwd, "replay"));
    buildFixtures({ models: MODELS }, replayPaths, "claim-verification");
  });

  it("replays the local baseline with accuracy and no malformed results", async () => {
    const report = await runReplay(DEFAULT_DECISION_CONFIG, replayPaths, {
      engineId: "local",
      decision: "claim-verification",
    });
    assert.equal(report.malformed, 0);
    assert.ok(report.accuracy !== undefined && report.accuracy > 0.5);
    assert.equal(report.runs.length, report.fixtures);
  });

  it("compares two engines and evaluates the gate", async () => {
    const report = await runReplay(DEFAULT_DECISION_CONFIG, replayPaths, {
      engineId: "local",
      compareEngineId: "local",
      gate: true,
      decision: "claim-verification",
    });
    assert.equal(report.comparison?.paired, report.fixtures);
    assert.equal(report.comparison?.agreement, 1);
    assert.equal(report.gate?.pass, true);
  });

  it("refuses jev without remote opt-in and without a stored key", async () => {
    await assert.rejects(
      makeExecutor("jev", DEFAULT_DECISION_CONFIG),
      /remote Jev is disabled/,
    );

    withUserConfig({});
    await assert.rejects(
      makeExecutor("jev", { ...DEFAULT_DECISION_CONFIG, remote: { jev: { enabled: true } } }),
      /no Jev API key/,
    );

    withUserConfig({ [JEV_KEY_PROVIDER_ID]: "test-key" });
    const executor = await makeExecutor("jev", {
      ...DEFAULT_DECISION_CONFIG,
      remote: { jev: { enabled: true } },
    });
    assert.equal(executor.engineId, "jev");

    await assert.rejects(makeExecutor("mystery", DEFAULT_DECISION_CONFIG), /unknown engine/);
  });
});

describe("jev dispatcher", () => {
  it("throws a clean operator error for an unknown subcommand", async () => {
    await assert.rejects(
      dispatchJevCommand(["nonsense"]),
      (error: unknown) => error instanceof JevOperatorError && /unknown subcommand/.test(error.message),
    );
  });

  it("throws for a missing required flag", async () => {
    await assert.rejects(
      dispatchJevCommand(["reliability", "--decision", "model-tier"]),
      /--engine is required/,
    );
  });
});
