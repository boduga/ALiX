import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeSupervisorEffect,
  SUPERVISOR_EFFECT_HOLD,
} from "../../../src/execution/filesystem/supervisor-effect-executor.js";
import { createScopedMutationService } from "../../../src/execution/filesystem/scoped-mutation.js";

test("supervisor effect executor rejects arbitrary and apparently valid requests", async () => {
  const requests: unknown[] = [
    undefined, null, {}, { authorized: true },
    {
      attemptId: "a", retryGeneration: 1, nonce: "n", operation: "create",
      targetSha256: "a".repeat(64), requestSha256: "b".repeat(64),
    },
    { effect: () => { throw new Error("must not execute"); }, authorized: true },
  ];
  for (const request of requests) {
    assert.deepEqual(await executeSupervisorEffect(request), {
      disposition: "DENY", code: SUPERVISOR_EFFECT_HOLD,
      effectStarted: false, effectsPerformed: 0,
    });
  }
});

test("even malicious getters and callbacks cannot execute", async () => {
  let touched = false;
  const request = Object.defineProperty({}, "authorized", {
    get() { touched = true; throw new Error("untrusted getter"); },
  });
  await executeSupervisorEffect(request);
  assert.equal(touched, false);
});

test("production scoped mutation factory remains fail-closed on Linux", async () => {
  const service = createScopedMutationService("linux");
  await assert.rejects(
    service.mutate({ workspaceRoot: "/", ownedScope: ".", workerId: "w", policyRevision: "p", leaseId: "l" },
      { kind: "create", relativePath: "x", content: new Uint8Array([1]) }),
    /qualified scoped mutation backend unavailable/,
  );
});
