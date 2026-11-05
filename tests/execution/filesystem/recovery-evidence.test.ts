import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  examineRecovery, fixtureAppend, fixtureCheckpoint, GENESIS_HASH,
  GE04_RECOVERY_DENIAL,
  type RecoveryEvent,
} from "../../../src/execution/filesystem/recovery-evidence.js";
import { createScopedMutationService, UnavailableScopedMutationService } from "../../../src/execution/filesystem/scoped-mutation.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const attemptId = "attempt.001";
const base = {
  attemptId, workerId: "worker.001", policyRevision: "revision.1",
  approvalId: "approval.001", leaseId: "lease.001",
  requestSha256: sha("exact input bytes"), releaseSha256: sha("signed release bytes"),
};
function prepared(previous: RecoveryEvent[] = []) {
  return fixtureAppend(previous, { ...base, phase: "prepared", claimedOutcome: null, claimedEffectSha256: null });
}
function entered(previous: RecoveryEvent[]) {
  return fixtureAppend(previous, { ...base, phase: "effect_entered", claimedOutcome: null, claimedEffectSha256: null });
}
function receipt(previous: RecoveryEvent[], claimedOutcome: "success" | "failed" | "unknown" = "success") {
  return fixtureAppend(previous, {
    ...base, phase: "receipt_reported", claimedOutcome,
    claimedEffectSha256: sha("claimed effect, NOT kernel proof"),
  });
}
function assertDenied(events: unknown, anchor: unknown = fixtureCheckpoint(events as RecoveryEvent[]), id: unknown = attemptId) {
  const verdict = examineRecovery(events, anchor, id);
  assert.equal(verdict.disposition, "DENY");
  assert.equal(verdict.code, GE04_RECOVERY_DENIAL);
  assert.equal("authorized" in verdict, false);
  assert.equal("receipt" in verdict, false);
  assert.equal("replay" in verdict, false);
  return verdict;
}

test("no journal cannot authorize a first effect or replay", () => {
  const v = assertDenied([], fixtureCheckpoint([]), attemptId);
  assert.equal(v.status, "UNVERIFIED");
  assert.ok(v.reasons.includes("empty_journal_no_provenance"));
});

test("prepared-only after fresh-process crash quarantines replay", () => {
  const journal = [prepared()];
  const snapshot = JSON.parse(JSON.stringify(journal));
  const recovered = assertDenied(snapshot, fixtureCheckpoint(journal));
  assert.equal(recovered.status, "QUARANTINED");
  assert.equal(recovered.syntacticallyConsistent, true);
  assert.ok(recovered.reasons.includes("attempt_replay_quarantined"));
});

test("effect-entered without receipt remains quarantined after restart", () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  const recovered = assertDenied(JSON.parse(JSON.stringify(journal)), fixtureCheckpoint(journal));
  assert.equal(recovered.status, "QUARANTINED");
  assert.equal(recovered.syntacticallyConsistent, true);
});

test("self-hashed success or failed receipts NEVER establish kernel outcome", () => {
  for (const outcome of ["success", "failed", "unknown"] as const) {
    const journal = [prepared()];
    journal.push(entered(journal));
    journal.push(receipt(journal, outcome));
    const decision = assertDenied(journal);
    assert.equal(decision.status, "QUARANTINED");
    assert.ok(decision.reasons.includes("independent_effect_provenance_not_demonstrated"));
    assert.equal(decision.syntacticallyConsistent, true);
  }
});

test("modified receipt hash, metadata and insertion are detected", () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  journal.push(receipt(journal));
  const clone = JSON.parse(JSON.stringify(journal));
  clone[2].claimedOutcome = "failed";
  assert.ok(assertDenied(clone).reasons.includes("journal_chain"));
  const extra = JSON.parse(JSON.stringify(journal));
  extra[1].force = true;
  assert.ok(assertDenied(extra).reasons.includes("event_schema"));
  const reordered = [journal[1], journal[0], journal[2]];
  assert.ok(assertDenied(reordered).reasons.some(x => ["journal_chain", "missing_preparation"].includes(x)));
});

test("checkpoint detects truncated journal, including an earlier well-formed prefix", () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  journal.push(receipt(journal));
  const checkpoint = fixtureCheckpoint(journal);
  const prefix = journal.slice(0, 2);
  assert.ok(assertDenied(prefix, checkpoint).reasons.includes("checkpoint_mismatch_or_missing"));
  assert.ok(assertDenied(journal, null).reasons.includes("checkpoint_mismatch_or_missing"));
  assert.ok(assertDenied(journal, { count: 3, headHash: GENESIS_HASH }).reasons.includes("checkpoint_mismatch_or_missing"));
});

test("entire-chain forgery including a caller-controlled checkpoint still never grants authority", () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  journal.push(receipt(journal));
  const forged = [prepared()];
  forged.push(entered(forged));
  forged.push(receipt(forged, "failed"));
  const verdict = assertDenied(forged, fixtureCheckpoint(forged));
  assert.equal(verdict.syntacticallyConsistent, true);
  assert.ok(verdict.reasons.includes("independent_effect_provenance_not_demonstrated"));
});

test("missing preparation, repeated phases and identity-switch are detected", () => {
  const start = [prepared()];
  assert.ok(assertDenied([entered([])]).reasons.includes("missing_preparation"));
  const duplicate = [prepared()];
  duplicate.push(prepared(duplicate));
  assert.ok(assertDenied(duplicate).reasons.includes("phase_or_identity_rewrite"));
  const switchId = [prepared()];
  switchId.push(fixtureAppend(switchId, {
    ...base, workerId: "different.001", phase: "effect_entered",
    claimedOutcome: null, claimedEffectSha256: null,
  }));
  assert.ok(assertDenied(switchId).reasons.includes("phase_or_identity_rewrite"));
  void start;
});

test("missing receipt does not license retry under a fresh attempt ID", () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  const decision = assertDenied(journal, fixtureCheckpoint(journal), "different.002");
  assert.equal(decision.status, "UNVERIFIED");
  assert.equal(decision.disposition, "DENY");
  assert.ok(decision.reasons.includes("independent_effect_provenance_not_demonstrated"));
});

test("malformed events and excessive journal size fail closed", () => {
  assert.ok(assertDenied("bad", null).reasons.includes("invalid_journal"));
  const journal = [prepared()];
  const malformed = [Object.assign({}, journal[0], { attemptId: "" })];
  assert.ok(assertDenied(malformed).reasons.includes("event_payload"));
  const tooLong = new Array(4097).fill(journal[0]);
  assert.ok(assertDenied(tooLong).reasons.includes("invalid_journal"));
  assert.throws(() => fixtureAppend([], {
    ...base, phase: "receipt_reported", claimedOutcome: null, claimedEffectSha256: null,
  }), /Invalid GE-04 fixture/);
});

test("production mutation backend stays unavailable regardless of recovery status", async () => {
  const journal = [prepared()];
  journal.push(entered(journal));
  journal.push(receipt(journal));
  assert.equal(assertDenied(journal).disposition, "DENY");
  for (const platform of ["linux", "darwin", "win32", "freebsd"] as const) {
    const service = createScopedMutationService(platform);
    assert.ok(service instanceof UnavailableScopedMutationService);
    await assert.rejects(service.mutate({
      workspaceRoot: "/tmp/fixture", ownedScope: "owned", workerId: base.workerId,
      policyRevision: base.policyRevision, leaseId: base.leaseId, approvalId: base.approvalId,
    }, { kind: "delete", relativePath: "owned/example" }), /unavailable \(fail closed\)/);
  }
});
