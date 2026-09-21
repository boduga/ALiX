import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProjectionRejectedError,
  inspectRemoteProjection,
  projectForRemote,
  sealForRemote,
  stableStringify,
  verifySealedProjection,
  type Projector,
} from "../../src/decision/index.js";

describe("boundary happy path", () => {
  it("seals minimal projections with stable key-order-insensitive hash", () => {
    const a = sealForRemote("context-relevance", "v1", { objective: "route fast", item: "doc 1" }, { now: 1 });
    const b = sealForRemote("context-relevance", "v1", { item: "doc 1", objective: "route fast" }, { now: 2 });
    assert.equal(a.sealed, "remote");
    assert.equal(a.hash, b.hash);
    assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(verifySealedProjection(a), true);
  });

  it("single legit keys pass (no over-blocking)", () => {
    assert.deepEqual(inspectRemoteProjection({ objective: "x", item: "y" }), []);
    assert.deepEqual(inspectRemoteProjection({ status: "open", claim: "y" }), []);
  });

  it("tampered payload or hash fails verification", () => {
    const sealed = sealForRemote("claim-verification", "v1", { claim: "sky blue" }, { now: 1 });
    assert.equal(verifySealedProjection({ ...sealed, hash: "sha256:dead" }), false);
    assert.equal(verifySealedProjection({ ...sealed, payload: { claim: "sky green" } }), false);
    assert.equal(verifySealedProjection({ ...sealed, sealed: "local" }), false);
    assert.equal(verifySealedProjection(null), false);
  });

  it("stableStringify sorts nested keys deterministically", () => {
    assert.equal(stableStringify({ b: 1, a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2},"b":1}');
  });
});

describe("boundary failure path", () => {
  it("rejects non-object and non-JSON-safe payloads", () => {
    for (const bad of [null, "str", [1], 42]) {
      assert.throws(() => sealForRemote("model-tier", "v1", bad as never), ProjectionRejectedError);
    }
    assert.throws(
      () => sealForRemote("model-tier", "v1", { a: undefined } as unknown as Record<string, unknown>),
      ProjectionRejectedError,
    );
    assert.throws(
      () => sealForRemote("model-tier", "v1", { f: (() => 1) } as unknown as Record<string, unknown>),
      ProjectionRejectedError,
    );
  });

  it("rejects oversize and over-deep payloads", () => {
    assert.throws(
      () => sealForRemote("context-relevance", "v1", { item: "word ".repeat(14_000) }),
      /max size/,
    );
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 12; i++) deep = { nest: deep };
    assert.throws(() => sealForRemote("context-relevance", "v1", deep), /max depth/);
  });

  it("rejects empty decision and projector version", () => {
    assert.throws(() => sealForRemote("" as never, "v1", { a: "b" }), ProjectionRejectedError);
    assert.throws(() => sealForRemote("model-tier", "", { a: "b" }), ProjectionRejectedError);
  });
});

describe("boundary security/governance (JEV-2..JEV-6)", () => {
  it("JEV-3: secret-bearing values rejected, repeatedly (stateless)", () => {
    const secrets = [
      "sk-abcdefghijklmnopqrstuvwx",
      "ghp_123456789012345678901234567890123456",
      "Bearer abcdefghijklmnop",
      "AKIAIOSFODNN7EXAMPLE",
      "password: s3cr3t-value!",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ];
    for (const run of [0, 1]) {
      for (const s of secrets) {
        assert.throws(
          () => sealForRemote("claim-verification", "v1", { evidence: s }),
          ProjectionRejectedError,
          `run ${run}: ${s.slice(0, 12)}`,
        );
      }
    }
  });

  it("JEV-3: prohibited keys rejected even with innocent values", () => {
    for (const key of ["apiKey", "SECRET", "token", "toolOutput", "sourceText", "fileContents", "executionState"]) {
      assert.throws(
        () => sealForRemote("claim-verification", "v1", { [key]: "hello" }),
        /prohibited key/,
        key,
      );
    }
  });

  it("JEV-2: raw ExecutionState shape rejected", () => {
    const rawState = {
      executionId: "e1",
      schemaVersion: "1.0.0",
      version: 3,
      step: 1,
      objective: "x",
      status: "running",
      intent: "code",
      pendingActions: [],
      activeCapabilities: [],
      constraints: [],
      artifacts: [],
    };
    assert.throws(() => sealForRemote("model-tier", "v1", rawState), /ExecutionState/);
  });

  it("JEV-4: raw tool-result shape rejected", () => {
    const toolResult = { toolUseId: "t1", content: "ok", invocationId: "i1", executionId: "e1" };
    assert.throws(() => sealForRemote("context-relevance", "v1", toolResult), /tool result/);
  });

  it("partial raw state rejected from two keys; lone objective still passes", () => {
    assert.throws(
      () => sealForRemote("model-tier", "v1", { objective: "x", status: "running", note: "y" }),
      /ExecutionState/,
    );
    assert.deepEqual(inspectRemoteProjection({ objective: "x", item: "y" }), []);
  });

  it("single correlation key rejected (lifted, not extracted)", () => {
    assert.throws(
      () => sealForRemote("context-relevance", "v1", { item: "y", executionId: "e1" }),
      /tool result/,
    );
  });
});

describe("projector contract", () => {
  it("projectForRemote seals projector output", () => {
    const projector: Projector<{ claim: string }, { claim: string }> = {
      decision: "claim-verification",
      version: "v1",
      project: (input) => ({ claim: input.claim }),
    };
    const sealed = projectForRemote(projector, { claim: "sky blue" }, { now: 7 });
    assert.equal(sealed.decision, "claim-verification");
    assert.equal(sealed.projectorVersion, "v1");
    assert.equal(verifySealedProjection(sealed), true);
  });

  it("throwing projector blocks the remote call (nothing seals)", () => {
    const bad: Projector<unknown, Record<string, unknown>> = {
      decision: "model-tier",
      version: "v1",
      project: () => {
        throw new Error("missing required field: taskFeatures");
      },
    };
    assert.throws(() => projectForRemote(bad, {}), /missing required field/);
  });

  it("secret-emitting projector blocked at seal", () => {
    const leaky: Projector<unknown, Record<string, unknown>> = {
      decision: "context-relevance",
      version: "v1",
      project: () => ({ item: "token sk-abcdefghijklmnopqrstuvwx" }),
    };
    assert.throws(() => projectForRemote(leaky, {}), ProjectionRejectedError);
  });
});
