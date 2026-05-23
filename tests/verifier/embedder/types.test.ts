import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  VerificationEmbedding,
  FailureRecord,
  EmbedderConfig,
  SimilarityResult,
} from "../../../src/verifier/embedder/types.js";

describe("Embedder Types", () => {
  it("VerificationEmbedding has required fields", () => {
    const embedding: VerificationEmbedding = {
      id: "test-1",
      sessionId: "session-123",
      taskType: "research",
      filePatterns: ["src/**/*.ts"],
      errorPatterns: ["TypeError", "undefined"],
      toolSequence: ["file.read", "shell.run"],
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      createdAt: Date.now(),
    };

    assert.ok(embedding.id);
    assert.ok(embedding.sessionId);
    assert.equal(embedding.embedding.length, 3);
  });

  it("FailureRecord includes resolution", () => {
    const record: FailureRecord = {
      id: "fail-1",
      sessionId: "session-123",
      task: "fix auth bug",
      errorSummary: "Cannot read property of undefined",
      fileChanges: ["src/auth.ts"],
      resolution: "Added null check before property access",
      resolvedAt: Date.now(),
      embeddingId: "test-1",
    };

    assert.ok(record.resolution);
    assert.ok(record.resolvedAt);
  });

  it("SimilarityResult includes score", () => {
    const result: SimilarityResult = {
      record: {} as FailureRecord,
      score: 0.85,
      matchedPatterns: ["TypeError"],
    };

    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.matchedPatterns.length > 0);
  });
});
