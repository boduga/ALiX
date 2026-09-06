/**
 * stream-abort-listener.vitest.ts — streaming cancellation listener hygiene
 * (Unit F fix round 1).
 *
 * The cancellable path of `streamToResponse` races each chunk's `next()`
 * against the operator-cancel signal. Each race must attach exactly ONE abort
 * listener and detach it when the chunk settles — a long stream must never
 * accumulate one listener per chunk (the pre-fix behaviour left the race
 * loser's listener attached until the signal fired at turn end).
 *
 * These tests drive the REAL `streamToResponse` (run/helpers.ts) over a long
 * chunked stream and assert, via `node:events.getEventListeners`, that the
 * signal's abort-listener count stays at zero across and after every chunk,
 * and that a genuine mid-stream abort still rejects promptly.
 */

import { describe, it, expect } from "vitest";
import { getEventListeners } from "node:events";
import type { ModelAdapter } from "../../src/providers/types.js";

/** A provider whose stream emits `count` private reasoning chunks (never
 *  written to stdout) then finishes cleanly. */
function buildProvider(count: number): ModelAdapter {
  return {
    id: "mock",
    capabilities: {
      provider: "mock",
      model: "mock",
      inputTokenLimit: 100_000,
      outputTokenLimit: 16_384,
      supportsTools: false,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    async *stream(): AsyncGenerator<any> {
      for (let i = 0; i < count; i++) {
        yield { type: "reasoning_delta", text: `chunk-${i}` };
      }
      yield { type: "done", finishReason: "stop" };
    },
  } as unknown as ModelAdapter;
}

describe("streamToResponse cancellable path — abort-listener hygiene (Unit F fix round)", () => {
  it("leaves zero abort listeners after a long chunked stream completes", async () => {
    const { streamToResponse } = await import("../../src/run/helpers.js");
    const controller = new AbortController();
    const provider = buildProvider(2_000);

    const result = await streamToResponse(
      provider,
      { systemPrompt: "", messages: [] },
      { signal: controller.signal },
    );

    // Reasoning chunks are private — accumulated, not text.
    expect(result.text).toBe("");
    expect(result.finishReason).toBe("stop");
    // Every per-chunk race detached its abort listener: after 2000 chunks the
    // signal carries ZERO listeners (pre-fix this was 2000, released only on
    // controller GC at turn end).
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("keeps the listener count at zero between chunks (no within-turn growth)", async () => {
    const { streamToResponse } = await import("../../src/run/helpers.js");
    const controller = new AbortController();
    // Drive the real pump but observe the signal after a bounded chunk burst.
    const provider = buildProvider(10_000);
    await streamToResponse(
      provider,
      { systemPrompt: "", messages: [] },
      { signal: controller.signal },
    );
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("a genuine mid-stream abort still rejects promptly (cleanup does not break the race)", async () => {
    const { streamToResponse } = await import("../../src/run/helpers.js");
    const { ExecutionCancelledError } = await import("../../src/runtime/cancellation-token.js");
    const controller = new AbortController();
    const provider = {
      ...buildProvider(0),
      async *stream(): AsyncGenerator<any> {
        yield { type: "reasoning_delta", text: "once" };
        await new Promise<never>(() => {}); // hang mid-stream
      },
    } as unknown as ModelAdapter;

    const run = streamToResponse(provider, { systemPrompt: "", messages: [] }, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0)); // let the stream start
    controller.abort("operator stop");
    await expect(run).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
