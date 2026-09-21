import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JournalReadError,
  JournalValidationError,
  JournalWriteError,
  createDecisionJournalStore,
  recordDecision,
  writeDebugPayload,
  type RecordDecisionInput,
} from "../../src/decision/index.js";

function input(overrides?: Partial<RecordDecisionInput>): RecordDecisionInput {
  return {
    decision: "claim-verification",
    engineId: "local",
    executionId: "exec-1",
    projectionHash: "sha256:abc",
    projectorVersion: "v1",
    outcome: { kind: "choice", choice: "supported", candidates: ["supported", "contradicted"] },
    thresholdProfile: "claim-verification/local/v1",
    policyVersion: "pol-1",
    latencyMs: 4,
    remote: false,
    redactionApplied: false,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe("journal record", () => {
  it("builds replay-oriented provenance", () => {
    const record = recordDecision(input());
    assert.match(record.decisionId, /^[0-9a-f-]{36}$/);
    assert.equal(record.timestamp, 1_700_000_000_000);
    assert.equal(record.projectionHash, "sha256:abc");
    assert.equal(record.thresholdProfile, "claim-verification/local/v1");
    assert.deepEqual(record.outcome, {
      kind: "choice",
      choice: "supported",
      candidates: ["supported", "contradicted"],
    });
  });

  it("records failure outcomes with fallback metadata", () => {    const record = recordDecision(
      input({
        outcome: { kind: "failure", error: "timeout after 3000ms", fallbackEngine: "local" },
        remote: true,
        redactionApplied: true,
      }),
    );
    assert.deepEqual(record.outcome, {
      kind: "failure",
      error: "timeout after 3000ms",
      fallbackEngine: "local",
    });
    assert.equal(record.redactionApplied, true);
  });

  it("rejects missing provenance and out-of-range natives", () => {
    assert.throws(() => recordDecision(input({ engineId: "" })), JournalValidationError);
    assert.throws(() => recordDecision(input({ projectionHash: "" })), JournalValidationError);
    assert.throws(() => recordDecision(input({ latencyMs: -1 })), JournalValidationError);
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "score", score: 1.5 } })),
      JournalValidationError,
    );
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "noul", probability: -0.1 } })),
      JournalValidationError,
    );
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "failure", error: "" } })),
      JournalValidationError,
    );
  });

  it("choice requires a non-empty candidate set containing the choice", () => {
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "choice", choice: "supported" } })),
      JournalValidationError,
    );
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "choice", choice: "supported", candidates: [] } })),
      JournalValidationError,
    );
    assert.throws(
      () => recordDecision(input({ outcome: { kind: "choice", choice: "other", candidates: ["supported"] } })),
      JournalValidationError,
    );
  });

  it("carries the state/version identifier when provided", () => {
    const record = recordDecision(input({ stateVersion: "hist:47:9f3a" }));
    assert.equal(record.stateVersion, "hist:47:9f3a");
    assert.equal(recordDecision(input()).stateVersion, undefined);
  });
});

describe("journal store", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-decision-journal-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty store reads empty; append round-trips with queries", () => {
    const store = createDecisionJournalStore(join(dir, "s1"));
    assert.deepEqual(store.readAll(), []);
    const r1 = recordDecision(input({ now: 10 }));
    const r2 = recordDecision(input({ decision: "model-tier", executionId: "exec-2", now: 11 }));
    store.append(r1);
    store.append(r2);
    assert.equal(store.readAll().length, 2);
    assert.equal(store.findByDecision("model-tier").length, 1);
    assert.equal(store.findByExecution("exec-1").length, 1);
    assert.equal(store.findByProjectionHash("sha256:abc").length, 2);
    assert.equal(store.readAll().length, 2);
  });

  it("sensitive payload never persisted by default; debug separate + gated", () => {
    const storeDir = join(dir, "s2");
    const store = createDecisionJournalStore(storeDir);
    const secret = "sk-abcdefghijklmnopqrstuvwx";
    store.append(recordDecision(input({ now: 20 })));
    writeDebugPayload(storeDir, "d1", { evidence: secret }, { enabled: false });
    const ledger = readFileSync(join(storeDir, "decisions.jsonl"), "utf8");
    assert.equal(ledger.includes(secret), false);
    assert.equal(existsSync(join(storeDir, "debug", "d1.json")), false);
    writeDebugPayload(storeDir, "d1", { evidence: "public excerpt" }, { enabled: true });
    assert.equal(existsSync(join(storeDir, "debug", "d1.json")), true);
    const ledgerAfter = readFileSync(join(storeDir, "decisions.jsonl"), "utf8");
    assert.equal(ledgerAfter.includes("public excerpt"), false);
  });

  it("journal failure policy: I/O errors surface explicitly", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a dir", "utf8");
    const store = createDecisionJournalStore(join(blocker, "inner"));
    assert.throws(() => store.append(recordDecision(input({ now: 30 }))), JournalWriteError);
  });

  it("corrupt ledger line fails closed with location", () => {
    const corruptDir = join(dir, "s3");
    const store = createDecisionJournalStore(corruptDir);
    store.append(recordDecision(input({ now: 40 })));
    writeFileSync(join(corruptDir, "decisions.jsonl"), "not-json{\n", "utf8");
    assert.throws(() => store.readAll(), JournalReadError);
  });
});
