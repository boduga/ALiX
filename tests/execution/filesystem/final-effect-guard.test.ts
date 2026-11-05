import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assessFinalEffect, requestDigest, FINAL_EFFECT_PROTOCOL,
  FINAL_EFFECT_DENIED,
} from "../../../src/execution/filesystem/final-effect-guard.js";
import {
  createScopedMutationService, UnavailableScopedMutationService,
} from "../../../src/execution/filesystem/scoped-mutation.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const raw = new TextEncoder().encode("operation=create\npath=owned/a.txt\ncontent=example");
const now = 1_000_000;

function fixture() {
  const claim = {
    protocol: FINAL_EFFECT_PROTOCOL,
    attemptId: "attempt.001", workerId: "worker.001",
    policyRevision: "revision.3", approvalId: "approval.001",
    leaseId: "lease.001", requestSha256: requestDigest(raw),
    releaseSha256: sha("independently provisioned release fixture ONLY"),
    expiresAtMs: now + 10_000,
  };
  const observation = {
    attemptId: claim.attemptId, workerId: claim.workerId,
    policyRevision: claim.policyRevision, approvalId: claim.approvalId,
    approvalStatus: "approved" as const, approvalConsumed: false,
    leaseId: claim.leaseId, leaseStatus: "active" as const,
    requestSha256: claim.requestSha256, releaseSha256: claim.releaseSha256,
    expiresAtMs: claim.expiresAtMs, policyAllows: true,
  };
  return { claim, observation };
}

function denied(claim: unknown, observed: unknown, bytes: unknown = raw, time: unknown = now) {
  const result = assessFinalEffect(claim, observed, bytes, time);
  assert.equal(result.disposition, "DENY");
  assert.equal(result.code, FINAL_EFFECT_DENIED);
  assert.equal("permit" in result, false);
  assert.equal("token" in result, false);
  assert.equal("authorize" in result, false);
  return result;
}

test("even perfectly matching fixture observations NEVER authorize final effect", () => {
  const { claim, observation } = fixture();
  const verdict = denied(claim, observation);
  assert.equal(verdict.checksMatched, true);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(Object.isFrozen(verdict), true);
});

test("exact request-byte substitution fails digest binding", () => {
  const { claim, observation } = fixture();
  assert.deepEqual(denied(claim, observation, new TextEncoder().encode("operation=delete\npath=owned/a.txt")).reasons, ["request_digest"]);
  assert.deepEqual(denied({ ...claim, requestSha256: sha("other") }, observation).reasons, ["request_digest"]);
  assert.deepEqual(denied(claim, { ...observation, requestSha256: sha("other") }).reasons, ["request_digest"]);
});

test("worker, attempt and store binding mismatches deny even when approval appears approved", () => {
  for (const key of ["attemptId", "workerId", "policyRevision", "approvalId", "leaseId"] as const) {
    const { claim, observation } = fixture();
    assert.ok(denied(claim, { ...observation, [key]: "different.999" }).reasons.includes(key), key);
    assert.ok(denied({ ...claim, [key]: "" }, observation).reasons.includes(key), key);
  }
});

test("release changes and malformed hashes deny", () => {
  const { claim, observation } = fixture();
  assert.ok(denied(claim, { ...observation, releaseSha256: sha("different") }).reasons.includes("release_digest"));
  assert.ok(denied({ ...claim, releaseSha256: "Z".repeat(64) }, observation).reasons.includes("release_digest"));
});

test("expiry is strict at final moment and cannot rely on admission-time acceptance", () => {
  const { claim, observation } = fixture();
  assert.ok(denied(claim, observation, raw, claim.expiresAtMs).reasons.includes("expired_or_mismatched"));
  assert.ok(denied(claim, observation, raw, claim.expiresAtMs + 1).reasons.includes("expired_or_mismatched"));
  assert.ok(denied(claim, { ...observation, expiresAtMs: now - 1 }).reasons.includes("expired_or_mismatched"));
  assert.ok(denied(claim, observation, raw, -1).reasons.includes("time_invalid"));
});

test("revocation, consumed approval and policy changes always deny", () => {
  const { claim, observation } = fixture();
  for (const status of ["pending", "denied", "consumed", "revoked"] as const) {
    assert.ok(denied(claim, { ...observation, approvalStatus: status }).reasons.includes("approval_state"));
  }
  assert.ok(denied(claim, { ...observation, approvalConsumed: true }).reasons.includes("approval_state"));
  for (const status of ["revoked", "expired", "released"] as const) {
    assert.ok(denied(claim, { ...observation, leaseStatus: status }).reasons.includes("lease_state"));
  }
  assert.ok(denied(claim, { ...observation, policyAllows: false }).reasons.includes("policy_denied"));
});

test("unknown metadata fields, malformed request and wrong protocol cannot bypass", () => {
  const { claim, observation } = fixture();
  assert.ok(denied({ ...claim, force: true }, observation).reasons.includes("claim_schema"));
  assert.ok(denied(claim, { ...observation, adminOverride: true }).reasons.includes("observation_schema"));
  assert.ok(denied({ ...claim, protocol: "ALIX_GE04_FINAL_EFFECT_V0" }, observation).reasons.includes("protocol"));
  assert.ok(denied(claim, observation, "not bytes").reasons.includes("request_bytes"));
  assert.ok(denied(claim, observation, new Uint8Array(1024 * 1024 + 1)).reasons.includes("request_bytes"));
  assert.ok(denied(claim, observation, raw, Number.NaN).reasons.includes("time_invalid"));
});

test("GE-04 backend remains unavailable regardless of fixture matching checks", async () => {
  const { claim, observation } = fixture();
  assert.equal(denied(claim, observation).checksMatched, true);
  for (const platform of ["linux", "darwin", "win32", "freebsd"] as const) {
    const service = createScopedMutationService(platform);
    assert.ok(service instanceof UnavailableScopedMutationService);
    await assert.rejects(service.mutate({
      workspaceRoot: "/tmp/fixture", ownedScope: "owned",
      workerId: claim.workerId, policyRevision: claim.policyRevision,
      leaseId: claim.leaseId, approvalId: claim.approvalId,
    }, {
      kind: "create", relativePath: "owned/a.txt", content: raw,
    }), /unavailable \(fail closed\)/);
  }
});
