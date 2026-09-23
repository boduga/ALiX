import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JEV_DEFAULT_MODEL,
  JEV_SYSTEMONE_ENDPOINT,
  JEV_WIRE_FORMAT_STATUS,
  MalformedResultError,
  createJevExecutor,
  fromJevResponse,
  fromJevRelevanceResponse,
  isJevChoiceAnswer,
  isJevNoulAnswer,
  projectClaimVerification,
  projectContextRelevance,
  toJevRequest,
  toJevRelevanceRequest,
  type JevSystemOneResponse,
} from "../../src/decision/index.js";

const SEALED_CLAIM = () =>
  projectClaimVerification(
    { claim: "Water boils at 100 degrees Celsius at sea level.", evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }] },
    { now: 1 },
  );

const SEALED_RELEVANCE = () =>
  projectContextRelevance(
    { objective: "Fix the timeout test", item: { id: "i1", text: "The provider wrapper enforces a timeout." } },
    { now: 1 },
  );

describe("System One wire shape (verified against the official docs)", () => {
  it("declares the verified status and the documented endpoint", () => {
    assert.equal(JEV_WIRE_FORMAT_STATUS, "verified-against-docs");
    assert.equal(JEV_SYSTEMONE_ENDPOINT, "https://api.typesafe.ai/v1/systemone");
    assert.equal(JEV_DEFAULT_MODEL, "jev-latest");
  });

  it("sends questions as a MAP keyed by id, with instructions + criteria", () => {
    const request = toJevRequest(SEALED_CLAIM());
    assert.deepEqual(Object.keys(request), ["state", "model", "questions"]);
    assert.equal(request.model, "jev-latest");

    const question = request.questions["claim-verdict"];
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    // Documented Choice fields; NOT the guessed `id` / `prompt` / `options`.
    assert.deepEqual(Object.keys(question).sort(), ["criteria", "instructions", "type"]);
    assert.equal("id" in question, false);
    assert.equal("prompt" in question, false);
    assert.equal("options" in question, false);
    assert.deepEqual(Object.keys(question.criteria).sort(), ["contradicted", "insufficient", "supported"]);
    for (const description of Object.values(question.criteria)) {
      assert.equal(typeof description, "string");
    }
  });

  it("sends a Noul as instructions + a true/false criteria pair", () => {
    const request = toJevRelevanceRequest(SEALED_RELEVANCE());
    const question = request.questions["context-relevant"];
    assert.equal(question.type, "noul");
    if (question.type !== "noul") return;
    assert.equal(typeof question.instructions, "string");
    assert.deepEqual(Object.keys(question.criteria ?? {}).sort(), ["false", "true"]);
  });

  it("reads a documented Choice response (map answers, probabilities, confidence)", () => {
    // Shape taken verbatim from https://docs.typesafe.ai/api.md
    const documented: JevSystemOneResponse = {
      model: "jev-1.13.0",
      answers: {
        "claim-verdict": {
          type: "choice",
          choice: "supported",
          probabilities: { supported: 0.88, contradicted: 0.12, insufficient: 0.0 },
          confidence: 0.81,
        },
      },
      usage: { input_tokens: 318, output_tokens: 34 },
    };
    const result = fromJevResponse(documented, { projectionHash: "sha256:x", latencyMs: 42 });
    assert.equal(result.kind, "choice");
    assert.equal(result.choice, "supported");
    assert.equal(result.confidence, 0.81);
    assert.equal(result.provenance.engineVersion, "jev-1.13.0");
    assert.equal(result.provenance.remote, true);
    // Provider-reported usage rides on provenance, not on the answer.
    assert.deepEqual(result.provenance.usage, { inputTokens: 318, outputTokens: 34 });
  });

  it("omits usage when the provider does not report it", () => {
    const result = fromJevResponse(
      { model: "jev-1.13.0", answers: { "claim-verdict": { type: "choice", choice: "supported" } } },
      { projectionHash: "sha256:x", latencyMs: 5 },
    );
    assert.equal(result.kind, "choice");
    assert.equal(result.provenance.usage, undefined);
  });

  it("reads a documented Noul response (`noul`, no confidence)", () => {
    const documented: JevSystemOneResponse = {
      model: "jev-1.13.0",
      answers: { "context-relevant": { type: "noul", noul: 0.93 } },
      usage: { input_tokens: 360, output_tokens: 39 },
    };
    const result = fromJevRelevanceResponse(documented, { projectionHash: "sha256:x", latencyMs: 12 });
    assert.equal(result.kind, "noul");
    assert.equal(result.probability, 0.93);
    assert.equal("confidence" in result, false);
  });

  it("narrows answers by their documented `type` discriminator", () => {
    assert.equal(isJevChoiceAnswer({ type: "choice", choice: "a" }), true);
    assert.equal(isJevChoiceAnswer({ type: "noul", noul: 0.5 }), false);
    assert.equal(isJevNoulAnswer({ type: "noul", noul: 0.5 }), true);
    assert.equal(isJevNoulAnswer({ type: "choice", choice: "a" }), false);
    assert.equal(isJevChoiceAnswer({ id: "legacy", choice: "a" }), false);
    assert.equal(isJevNoulAnswer({ id: "legacy", probability: 0.5 }), false);
  });

  it("rejects a legacy-shaped response instead of coercing it", () => {
    const legacy = { answers: [{ id: "claim-verdict", choice: "supported" }] } as unknown as JevSystemOneResponse;
    assert.throws(
      () => fromJevResponse(legacy, { projectionHash: "sha256:x", latencyMs: 1 }),
      MalformedResultError,
    );
  });

  it("does not send an id inside a question, so the executor owns the key", async () => {
    let seen: unknown;
    const executor = createJevExecutor({
      enabled: true,
      apiKey: "k",
      transport: async (request) => {
        seen = request;
        return { model: "jev-1.13.0", answers: { "claim-verdict": { type: "choice", choice: "supported" } } };
      },
    });
    await executor.execute({ decision: "claim-verification", sealed: SEALED_CLAIM() });
    const request = seen as { questions: Record<string, unknown> };
    assert.deepEqual(Object.keys(request.questions), ["claim-verdict"]);
  });
});
