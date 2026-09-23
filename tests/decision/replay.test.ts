import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FixtureValidationError,
  compareEngineRuns,
  createDecisionJournalStore,
  createJevExecutor,
  createLocalBaselineExecutor,
  costForRun,
  costFromUsage,
  estimateFixtureCostUsd,
  estimateInputTokens,
  evaluatePromotionGate,
  exportReplayFixture,
  isReplayFixture,
  listReplayFixtures,
  loadReplayFixture,
  projectClaimVerification,
  replayFixture,
  replaySuite,
  saveReplayFixture,
  type DecisionExecutor,
  type ExecutorOutcome,
  type JevTransport,
  type ReplayFixture,
} from "../../src/decision/index.js";

const CLAIM = (claim: string, evidence: string[]) => ({
  claim,
  evidence: evidence.map((excerpt) => ({ excerpt })),
});

const VERDICTS = ["supported", "contradicted", "insufficient"] as const;

function choiceTransport(choice: string): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: { "claim-verdict": { type: "choice", choice } },
  });
}

function jevExecutor(transport: JevTransport): DecisionExecutor {
  return createJevExecutor({
    enabled: true,
    apiKey: "k",
    transport,
  });
}

function claimFixture(
  id: string,
  claim = "Water boils at 100 degrees Celsius at sea level.",
  evidence = ["At sea level, water boils at 100 degrees Celsius."],
): ReplayFixture {
  const sealed = projectClaimVerification(CLAIM(claim, evidence), { now: 1 });
  return exportReplayFixture(sealed, {
    id,
    decision: "claim-verification",
    candidates: [...VERDICTS],
    expected: "supported",
    now: 1,
  });
}

const isSupported = (fixtureId: string, outcome: ExecutorOutcome): boolean =>
  outcome.kind === "choice" && outcome.choice === "supported";

describe("replay fixtures", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-replay-fixtures-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("exports only verified seals and round-trips through disk", () => {
    const fixture = claimFixture("f1");
    assert.equal(isReplayFixture(fixture), true);

    saveReplayFixture(join(dir, "f1.json"), fixture);
    saveReplayFixture(join(dir, "f0.json"), claimFixture("f0"));
    assert.deepEqual(loadReplayFixture(join(dir, "f1.json")).id, "f1");
    assert.deepEqual(
      listReplayFixtures(dir).map((entry) => entry.id),
      ["f0", "f1"],
    );
  });

  it("rejects forged, corrupt, and mismatched fixtures", () => {
    const forged = {
      sealed: "remote",
      decision: "claim-verification",
      projectorVersion: "claim-verification/v1",
      payload: { claim: "forged", evidence: [] },
      hash: "sha256:deadbeef",
      sealedAt: 1,
    };
    assert.throws(
      () => exportReplayFixture(forged as never, { id: "bad", decision: "claim-verification" }),
      FixtureValidationError,
    );
    assert.throws(() => exportReplayFixture(claimFixture("ok").sealed, { id: "", decision: "claim-verification" }), FixtureValidationError);

    writeFileSync(join(dir, "broken.json"), "not-json{", "utf8");
    assert.throws(() => loadReplayFixture(join(dir, "broken.json")), FixtureValidationError);
    assert.throws(() => loadReplayFixture(join(dir, "missing.json")), FixtureValidationError);
    assert.equal(isReplayFixture({ id: "x" }), false);
  });
});

describe("dry-run harness", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-replay-dryrun-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("replays through an executor and records latency", async () => {
    const run = await replayFixture(claimFixture("f1"), createLocalBaselineExecutor());
    assert.equal(run.fixtureId, "f1");
    assert.equal(run.engineId, "local");
    assert.equal(run.outcome.kind, "choice");
    assert.ok(Number.isFinite(run.latencyMs) && run.latencyMs >= 0);
  });

  it("rejects a rogue executor's invalid answer as malformed, never coerced", async () => {
    const rogue: DecisionExecutor = {
      engineId: "local",
      async execute() {
        return { kind: "choice", choice: "execute-plan" } as never;
      },
    };
    const run = await replayFixture(claimFixture("f1"), rogue);
    assert.equal(run.outcome.kind, "failure");
    assert.match(run.outcome.kind === "failure" ? run.outcome.error : "", /not in candidate set/);
  });

  it("turns transport failure and timeout into explicit failures, never throws", async () => {
    const failing = jevExecutor(async () => {
      throw new Error("socket hang up");
    });
    const failed = await replayFixture(claimFixture("f1"), failing);
    assert.equal(failed.outcome.kind, "failure");
    assert.match(failed.outcome.kind === "failure" ? failed.outcome.error : "", /f1 @ jev/);

    const hanging = jevExecutor(() => new Promise<never>(() => {}));
    const timedOut = await replayFixture(claimFixture("f1"), hanging, { timeoutMs: 20 });
    assert.equal(timedOut.outcome.kind, "failure");
    assert.match(timedOut.outcome.kind === "failure" ? timedOut.outcome.error : "", /timed out/);
  });

  it("cannot mutate runtime state: no journal, no tools, no extra files", async () => {
    const journal = createDecisionJournalStore(join(dir, "journal"));
    let transportCalls = 0;
    const observed = jevExecutor(async (request) => {
      transportCalls += 1;
      assert.ok(Object.keys(request.questions).length > 0);
      return { model: "jev-1.13.0", answers: { "claim-verdict": { type: "choice", choice: "supported" } } };
    });
    const suite = await replaySuite(
      [claimFixture("f1"), claimFixture("f2")],
      [createLocalBaselineExecutor(), observed],
    );
    assert.deepEqual(Object.keys(suite).sort(), ["jev", "local"]);
    assert.equal(suite.jev.length, 2);
    assert.equal(transportCalls, 2);
    // The harness admits no journal, approval store, or tool surface —
    // nothing was written anywhere. The journal directory was never even
    // created because nothing appended to it.
    assert.equal(journal.readAll().length, 0);
    assert.deepEqual(readdirSync(dir), []);
  });
});

describe("engine comparison", () => {
  const fixtures = [
    claimFixture("f1"),
    claimFixture("f2", "The sky appears blue because of Rayleigh scattering.", ["Rayleigh scattering makes the sky appear blue."]),
  ];

  it("agrees on identical answers, ignoring confidence and provenance", async () => {
    const baseline = await replaySuite(fixtures, [jevExecutor(choiceTransport("supported"))]);
    const candidate = await replaySuite(fixtures, [jevExecutor(choiceTransport("supported"))]);
    const comparison = compareEngineRuns({
      fixtures,
      baseline: baseline.jev,
      candidate: candidate.jev,
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(comparison.paired, 2);
    assert.equal(comparison.agreement, 1);
    assert.equal(comparison.baseline.accuracy, 1);
    assert.equal(comparison.baseline.malformed, 0);
  });

  it("disagrees on changed answers and reports both sides", async () => {
    const baseline = await replaySuite(fixtures, [jevExecutor(choiceTransport("supported"))]);
    const candidate = await replaySuite(fixtures, [jevExecutor(choiceTransport("contradicted"))]);
    const comparison = compareEngineRuns({
      fixtures,
      baseline: baseline.jev,
      candidate: candidate.jev,
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(comparison.agreement, 0);
    assert.equal(comparison.baseline.accuracy, 1);
    assert.equal(comparison.candidate.accuracy, 0);
  });

  it("agrees on continuous outcomes within tolerance, not by exact float", () => {
    const fixtures = [claimFixture("f1"), claimFixture("f2")];
    const noulRun = (fixtureId: string, probability: number) => ({
      fixtureId,
      engineId: "local",
      outcome: { kind: "noul" as const, probability, provenance: { engineId: "local", latencyMs: 1, remote: false, projectionHash: "sha256:x" } },
      latencyMs: 1,
    });
    // 0.05 apart -> agree; 0.4 apart -> disagree.
    const baseline = [noulRun("f1", 0.70), noulRun("f2", 0.20)];
    const candidate = [noulRun("f1", 0.75), noulRun("f2", 0.60)];
    const comparison = compareEngineRuns({
      fixtures,
      baseline,
      candidate,
      baselineEngineId: "local",
      candidateEngineId: "local",
    });
    assert.equal(comparison.continuousTolerance, 0.1);
    assert.equal(comparison.paired, 2);
    assert.equal(comparison.agreement, 0.5);
    assert.ok(Math.abs((comparison.meanAbsoluteDelta ?? 0) - 0.225) < 1e-9);

    // A tighter tolerance flips the first pair to disagreement.
    const tight = compareEngineRuns({
      fixtures,
      baseline,
      candidate,
      baselineEngineId: "local",
      candidateEngineId: "local",
      continuousTolerance: 0.01,
    });
    assert.equal(tight.agreement, 0);
  });

  it("excludes unpaired fixtures but still reports each side", async () => {
    const baseline = await replaySuite([fixtures[0]], [createLocalBaselineExecutor()]);
    const candidate = await replaySuite(fixtures, [createLocalBaselineExecutor()]);
    const comparison = compareEngineRuns({
      fixtures,
      baseline: baseline.local,
      candidate: candidate.local,
      baselineEngineId: "local",
      candidateEngineId: "local",
    });
    assert.equal(comparison.paired, 1);
    assert.equal(comparison.baseline.runs, 1);
    assert.equal(comparison.candidate.runs, 2);
    assert.equal(comparison.baseline.accuracy, undefined);
  });

  it("compares latency and cost between versions", async () => {
    const baseline = await replaySuite(fixtures, [jevExecutor(choiceTransport("supported"))]);
    const candidate = await replaySuite(fixtures, [createLocalBaselineExecutor()]);
    const comparison = compareEngineRuns({
      fixtures,
      baseline: baseline.jev,
      candidate: candidate.local,
      baselineEngineId: "jev",
      candidateEngineId: "local",
      isCorrect: isSupported,
    });
    assert.ok(Number.isFinite(comparison.latencyDeltaMs));
    assert.ok(comparison.baseline.totalCostUsd > 0);
    assert.equal(comparison.candidate.totalCostUsd, 0);
    assert.ok(comparison.costDeltaUsd < 0);
  });
});

describe("cost model", () => {
  it("estimates input tokens at chars/4 and prices Jev input", () => {
    assert.equal(estimateInputTokens("abcd"), 1);
    assert.equal(estimateFixtureCostUsd(claimFixture("f1"), "local"), 0);
    const big = claimFixture("f-big", "x".repeat(4_000), ["y".repeat(4_000)]);
    const small = claimFixture("f-small");
    assert.ok(estimateFixtureCostUsd(big, "jev") > estimateFixtureCostUsd(small, "jev"));
  });

  it("refuses to price an unknown engine", () => {
    assert.throws(() => estimateFixtureCostUsd(claimFixture("f1"), "mystery"), /No cost model/);
  });

  it("prefers provider-reported usage over the content estimate", () => {
    const fixture = claimFixture("f1");
    const estimate = estimateFixtureCostUsd(fixture, "jev");
    const exact = costFromUsage("jev", { inputTokens: 1_000_000, outputTokens: 0 });
    assert.ok(Math.abs(exact - 0.042) < 1e-12);
    assert.notEqual(exact, estimate);
    // costForRun uses the reported usage when present, the estimate otherwise.
    assert.equal(costForRun(fixture, "jev", { inputTokens: 1_000_000, outputTokens: 0 }), exact);
    assert.equal(costForRun(fixture, "jev"), estimate);
    assert.equal(costFromUsage("local", { inputTokens: 999, outputTokens: 999 }), 0);
  });

  it("carries reported usage onto the run and into the comparison", async () => {
    const withUsage = jevExecutor(async () => ({
      model: "jev-1.13.0",
      answers: { "claim-verdict": { type: "choice", choice: "supported" } },
      usage: { input_tokens: 400, output_tokens: 12 },
    }));
    const run = await replayFixture(claimFixture("f1"), withUsage);
    assert.deepEqual(run.usage, { inputTokens: 400, outputTokens: 12 });

    const fixtures = [claimFixture("f1")];
    const runs = (await replaySuite(fixtures, [withUsage])).jev;
    const comparison = compareEngineRuns({
      fixtures,
      baseline: runs,
      candidate: runs,
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(comparison.candidate.reportedInputTokens, 400);
    assert.equal(comparison.candidate.reportedOutputTokens, 12);
    // 400 input tokens at $0.042/MTok.
    assert.ok(Math.abs(comparison.candidate.totalCostUsd - (400 / 1_000_000) * 0.042) < 1e-12);
  });
});

describe("promotion regression gate", () => {
  const fixtures = [claimFixture("f1"), claimFixture("f2")];

  async function runsFor(choice: string) {
    return (await replaySuite(fixtures, [jevExecutor(choiceTransport(choice))])).jev;
  }

  it("passes an identical candidate", async () => {
    const result = evaluatePromotionGate({
      fixtures,
      baseline: await runsFor("supported"),
      candidate: await runsFor("supported"),
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(result.pass, true);
    assert.deepEqual(result.reasons, []);
  });

  it("fails on disagreement below the floor", async () => {
    const result = evaluatePromotionGate({
      fixtures,
      baseline: await runsFor("supported"),
      candidate: await runsFor("contradicted"),
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some((reason) => reason.includes("agreement")));
  });

  it("fails on accuracy regression beyond the allowance", async () => {
    const permissive = await evaluatePromotionGate({
      fixtures,
      baseline: await runsFor("supported"),
      candidate: await runsFor("contradicted"),
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
      policy: { minAgreement: 0, maxAccuracyDrop: 1 },
    });
    assert.equal(permissive.pass, true);

    const strict = await evaluatePromotionGate({
      fixtures,
      baseline: await runsFor("supported"),
      candidate: await runsFor("contradicted"),
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
      policy: { minAgreement: 0, maxAccuracyDrop: 0 },
    });
    assert.equal(strict.pass, false);
    assert.ok(strict.reasons.some((reason) => reason.includes("accuracy dropped")));
  });

  it("fails on malformed outcomes and on an empty corpus", async () => {
    const malformed = await replaySuite(fixtures, [
      jevExecutor(async () => ({ answers: { "claim-verdict": { type: "choice", choice: "maybe" } } })),
    ]);
    const result = evaluatePromotionGate({
      fixtures,
      baseline: await runsFor("supported"),
      candidate: malformed.jev,
      baselineEngineId: "jev",
      candidateEngineId: "jev",
      isCorrect: isSupported,
    });
    assert.equal(result.pass, false);
    assert.ok(result.reasons.some((reason) => reason.includes("malformed")));

    const empty = evaluatePromotionGate({
      fixtures: [],
      baseline: [],
      candidate: [],
      baselineEngineId: "jev",
      candidateEngineId: "jev",
    });
    assert.equal(empty.pass, false);
    assert.ok(empty.reasons.some((reason) => reason.includes("no fixtures")));
  });
});
