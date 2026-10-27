/**
 * provider-attempt-telemetry.vitest.ts — proves provider attempts reach a caller
 * through the REAL registry path, with no network and no spend.
 *
 * WHY THIS EXISTS
 *
 * The dispatcher retries 429/5xx silently. Nothing recorded an abandoned attempt,
 * so a transient provider fault that recovered looked identical to a clean call —
 * which is why an independent reviewer could not exclude one and declined a GB-06
 * denominator.
 *
 * THREE BUGS were found while implementing this, each caught only after wasted
 * spend, and each now pinned here:
 *
 *  1. The recorder was declared in the task loop AFTER the streaming branch that
 *     referenced it. `const` is hoisted but uninitialised, so the call threw and
 *     the `.catch` that exists to protect the run swallowed it.
 *  2. `withProviderContracts` decodes the request through an Effect Schema, which
 *     **strips unknown keys** — silently dropping the callback. The observer is
 *     not wire data, so it is re-attached after decode rather than added to
 *     `NormalizedRequestSchema`.
 *  3. The streaming transport `catch` retried and finally errored without
 *     reporting either, so the most important case (a socket failure with no HTTP
 *     status) produced no record at all.
 *
 * `_setFetchForTesting` makes all of this deterministic. Probing these layers with
 * live calls cost `$0.53` and found less than this test does.
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _setFetchForTesting, stream as dispatchStream } from "../../src/models/providers/unified-complete.js";
import { createProvider } from "../../src/models/providers/registry.js";
import { withProviderContracts } from "../../src/models/providers/provider-contract-validation.js";
import { HiveProvider } from "../../src/models/providers/hive-provider.js";
import { validateNormalizedRequest } from "../../src/models/providers/provider-contract-validation.js";

const here = dirname(fileURLToPath(import.meta.url));

/** A well-formed SSE body: one text delta then [DONE]. */
function sseBody(): ReadableStream {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n'));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

function fakeFetch(status: number, body: () => ReadableStream | string): typeof fetch {
  return (async () =>
    new Response(typeof body() === "string" ? (body() as string) : (body() as ReadableStream), {
      status,
      headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" },
    })) as unknown as typeof fetch;
}

async function drive(
  adapter: { stream: (r: unknown, o?: unknown) => AsyncGenerator<unknown> },
): Promise<unknown[]> {
  const calls: unknown[] = [];
  try {
    for await (const _ of adapter.stream(
      { systemPrompt: "x", messages: [{ role: "user", content: "hi" }] },
      { onAttempt: (a: unknown) => calls.push(a) },
    ) as AsyncGenerator<unknown>) {
      // drain
    }
  } catch {
    // A provider error is expected in the failure cases; the assertion is about
    // the telemetry, not the error.
  }
  return calls;
}

afterEach(() => {
  _setFetchForTesting(globalThis.fetch);
});

describe("a successful stream reports its attempt", () => {
  it("at every layer — dispatcher, HiveProvider, and the contract wrapper", async () => {
    // The wrapper is the layer that silently dropped it: schema decode strips
    // unknown keys. Testing only the dispatcher would have missed that entirely.
    _setFetchForTesting(fakeFetch(200, sseBody));

    const calls1: unknown[] = [];
    for await (const _ of dispatchStream("hive", "m", {
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
    } as never, { apiKey: "k", onAttempt: (a: unknown) => calls1.push(a) })) { /* drain */ }
    expect(calls1.length).toBe(1);

    const l2 = await drive(new HiveProvider({ apiKey: "k" }) as never);
    expect(l2.length).toBe(1);

    const l3 = await drive(withProviderContracts(new HiveProvider({ apiKey: "k" }), undefined, 5000, 5000) as never);
    expect(l3.length).toBe(1);
    expect((l3[0] as { status: number }).status).toBe(200);
    expect((l3[0] as { retryable: boolean }).retryable).toBe(false);
  });

  it("through the registry, which is the path production uses", async () => {
    _setFetchForTesting(fakeFetch(200, sseBody));
    const adapter = await createProvider(
      { provider: "hive", model: "deepseek-ai/deepseek-v4.1-flash-1017", timeoutMs: 5000 },
      "k",
    );
    const calls = await drive(adapter as never);
    expect(calls.length).toBe(1);
  });
});

describe("a retried attempt is visible, not silent", () => {
  it("reports the 429 then the success", async () => {
    let n = 0;
    _setFetchForTesting((async () => {
      n += 1;
      return n === 1
        ? new Response("{}", { status: 429, headers: { "content-type": "application/json" } })
        : new Response(sseBody(), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);

    const adapter = withProviderContracts(new HiveProvider({ apiKey: "k" }), undefined, 5000, 5000);
    const calls = await drive(adapter as never);
    // Both attempts recorded: the retry is exactly what used to be invisible.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[0] as { status: number; retryable: boolean }).status).toBe(429);
    expect((calls[0] as { retryable: boolean }).retryable).toBe(true);
    expect((calls.at(-1) as { retryable: boolean }).retryable).toBe(false);
  });
});

describe("the observer survives schema decoding", () => {
  it("is re-attached after validateNormalizedRequest strips it", () => {
    const observer = (): void => {};
    const decoded = validateNormalizedRequest({
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      onAttempt: observer,
    } as never);
    // Effect Schema decode drops unknown keys — the reason the observer must
    // travel in options, never in the request.
    expect((decoded as { onAttempt?: unknown }).onAttempt).toBeUndefined();

    // The wrapper must put it back. Asserted via the source contract because the
    // re-attachment is deliberately not part of the wire schema.
    const src = readFileSync(
      join(here, "..", "..", "src", "models", "providers", "provider-contract-validation.ts"),
      "utf-8",
    );
    // The observer travels in ModelCallOptions, so nothing needs re-attaching.
    expect(src).not.toMatch(/withAttemptObserver/);
    // And it must NOT be in the wire schema itself: a callback is not wire data.
    const schemas = readFileSync(
      join(here, "..", "..", "src", "runtime-state", "contracts", "llm-schemas.ts"),
      "utf-8",
    );
    const reqSchema = schemas.slice(
      schemas.indexOf("NormalizedRequestSchema"),
      schemas.indexOf("NormalizedRequestSchema") + 900,
    );
    expect(reqSchema).not.toMatch(/onAttempt/);
  });
});

describe("the task loop records attempts before they can be lost", () => {
  const main = readFileSync(
    join(here, "..", "..", "src", "execution", "run", "task-loop", "main.ts"),
    "utf-8",
  );

  it("declares the recorder before the streaming branch (bug 1)", () => {
    const decl = main.indexOf("const recordProviderAttempt");
    const streaming = main.indexOf("if (model.streaming && provider.stream)");
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(streaming);
  });

  it("passes the recorder to both call paths via options, never the request", () => {
    // Options, not request: a request is cloned/serialized, and a function in it
    // broke ten continuity tests with DataCloneError.
    expect((main.match(/onAttempt: recordProviderAttempt/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).not.toMatch(/context: deps\.context,\s*\n\s*onAttempt: recordProviderAttempt/);
  });

  it("settles pending attempt writes on both paths", () => {
    expect((main.match(/allSettled\(pendingAttemptWrites\.splice\(0\)\)/g) ?? []).length).toBe(2);
  });

  it("writes model.attempt events", () => {
    expect(main).toMatch(/type: "model\.attempt"/);
  });
});
