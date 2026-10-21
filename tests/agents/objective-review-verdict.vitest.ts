/**
 * objective-review-verdict.vitest.ts — pins verdict classification.
 *
 * The bug: a verdict of `satisfied: true` WITH non-empty `gaps` is
 * self-contradictory (the prompt requires `gaps: []` when satisfied). It passed
 * structural validation as `valid` and was then hard-rejected with no retry, so a
 * correct worker could fail on one inconsistent reviewer response.
 *
 * Observed on real gpt-4o coordination runs. The tell was the rejection text: a
 * gap string that read like a TASK ("Confirmation that docs/b.md contains exactly
 * 'B-MARKER'") rather than a mismatch description — exactly what a
 * satisfied-but-gapped verdict looks like.
 *
 * A malformed verdict must take the retry path, not become a rejection.
 */

import { describe, it, expect, vi } from "vitest";
import { reviewCoordinationResult } from "../../src/agents/coordination-objective-review.js";
import type { ModelAdapter } from "../../src/models/providers/types.js";

function providerReturning(...texts: string[]): Pick<ModelAdapter, "complete"> {
  let i = 0;
  return {
    complete: vi.fn(async () => {
      const text = texts[Math.min(i, texts.length - 1)]!;
      i++;
      return { text, toolCalls: [], usage: undefined } as never;
    }),
  } as never;
}

const successResult = {
  id: "w1",
  role: "worker" as const,
  status: "success" as const,
  findings: [{ type: "summary" as const, content: "wrote it", confidence: "medium" as const }],
  events: [],
};

function review(provider: Pick<ModelAdapter, "complete">) {
  return reviewCoordinationResult({
    result: successResult,
    objective: "Create docs/b.md containing exactly B-MARKER",
    mutatedPaths: ["docs/b.md"],
    evidence: [],
    provider,
    readArtifacts: async () => [{ path: "docs/b.md", content: "B-MARKER" }],
  });
}

describe("objective review verdict classification", () => {
  it("accepts a clean satisfied verdict", async () => {
    const out = await review(
      providerReturning('{"satisfied":true,"summary":"contains B-MARKER","gaps":[]}'),
    );
    expect(out.status).toBe("success");
  });

  it("RETRIES on satisfied:true with non-empty gaps instead of rejecting", async () => {
    // First response is contradictory; the retry is clean. Before the fix the
    // first response was accepted as `valid` and then hard-rejected — the worker
    // failed with no second chance.
    const provider = providerReturning(
      '{"satisfied":true,"summary":"done","gaps":["Confirmation that docs/b.md contains exactly B-MARKER"]}',
      '{"satisfied":true,"summary":"contains B-MARKER","gaps":[]}',
    );
    const out = await review(provider);
    expect(out.status).toBe("success");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("still rejects when satisfied is false, using the gaps as the reason", async () => {
    const out = await review(
      providerReturning('{"satisfied":false,"summary":"wrong","gaps":["wrote the wrong marker"]}'),
    );
    expect(out.status).not.toBe("success");
    expect(String(out.error)).toContain("wrong marker");
  });

  it("rejects satisfied:false with no gaps, falling back to the summary", async () => {
    const out = await review(
      providerReturning('{"satisfied":false,"summary":"content is A-MARKER","gaps":[]}'),
    );
    expect(out.status).not.toBe("success");
    expect(String(out.error)).toContain("A-MARKER");
  });

  it("fails closed after a retry that is still contradictory", async () => {
    // Two contradictory verdicts: the retry does not rescue a genuinely
    // inconsistent reviewer, and silence must never become success.
    const out = await review(
      providerReturning(
        '{"satisfied":true,"summary":"x","gaps":["gap"]}',
        '{"satisfied":true,"summary":"y","gaps":["gap"]}',
      ),
    );
    expect(out.status).not.toBe("success");
  });
});
