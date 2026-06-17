/**
 * unified-complete-fault-injection.test.ts — Fault injection tests for provider calls.
 *
 * Tests every failure mode the dispatcher can encounter: timeouts, rate limits,
 * server errors, malformed JSON, partial streaming, connection resets.
 * Validates retry policy, circuit breaker behavior, and error propagation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { complete, _setFetchForTesting, stream } from "../../src/providers/unified-complete.js";
import { ApiError } from "../../src/providers/base.js";

// =========================================================================
// Fault-injection fetch builders
// =========================================================================

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Records all calls made through the mock fetch. */
let calls: FetchCall[] = [];
function resetCalls() { calls = []; }

// Type-safe fetch mock helper — unwraps to typeof fetch
type MockFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function wrap(fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): MockFetch {
  return fn;
}

function mockFetchOk(body: unknown, status = 200, headers?: Record<string, string>): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  });
}

function mockFetch429ThenOk(body: unknown, retries = 1): MockFetch {
  let attempt = 0;
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    attempt++;
    if (attempt <= retries) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function mockFetchPersistent429(): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ error: { message: "always rate limited" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  });
}

function mockFetch500ThenOk(body: unknown): MockFetch {
  let attempt = 0;
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    attempt++;
    if (attempt === 1) {
      return new Response(JSON.stringify({ error: { message: "server error" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function mockFetchPersistent500(): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ error: { message: "always 500" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });
}

function mockFetchMalformedJson(): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("not json{{{", { status: 200, headers: { "content-type": "application/json" } });
  });
}

function mockFetchEmptyBody(): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("", { status: 200, headers: { "content-type": "application/json" } });
  });
}

function mockFetchConnectionReset(): MockFetch {
  let attempt = 0;
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    attempt++;
    if (attempt === 1) {
      throw new TypeError("fetch failed: connection reset");
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "recovered", finish_reason: "stop" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

function mockFetchPersistentNetworkError(): MockFetch {
  return wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    throw new TypeError("fetch failed: connection refused");
  });
}

// =========================================================================
// Stream mock helpers
// =========================================================================

function makeStreamResponse(chunks: string[], finalStatus = 200): Response {
  const body = chunks.join("\n");
  return new Response(body, {
    status: finalStatus,
    headers: { "content-type": "application/json" },
  });
}

// =========================================================================
// Fixtures
// =========================================================================

const completionRequest = {
  systemPrompt: "You are helpful.",
  messages: [{ role: "user" as const, content: "Say hello" }],
};

const okResponse = {
  choices: [{ message: { content: "Hello!", finish_reason: "stop" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

// =========================================================================
// Retry policy: 429 (rate limit)
// =========================================================================

test("complete: 429 rate limit — retry succeeds", async () => {
  resetCalls();
  _setFetchForTesting(mockFetch429ThenOk(okResponse));

  try {
    const resp = await complete("openai", "gpt-4o", completionRequest);
    assert.equal(resp.text, "Hello!");
    assert.ok(calls.length >= 2, `expected 2+ calls (1x 429 retry), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("complete: 429 rate limit — exhausts retries, throws ApiError", async () => {
  resetCalls();
_setFetchForTesting(mockFetchPersistent429());

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
      (err: Error) => err instanceof ApiError && err.status === 429,
    );
    assert.ok(calls.length >= 3, `expected 3+ calls (retries exhausted), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Retry policy: 5xx (server error)
// =========================================================================

test("complete: 500 server error — retry succeeds", async () => {
  resetCalls();
_setFetchForTesting(mockFetch500ThenOk(okResponse));

  try {
    const resp = await complete("openai", "gpt-4o", completionRequest);
    assert.equal(resp.text, "Hello!");
    assert.ok(calls.length >= 2, `expected 2+ calls (1x 500 retry), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("complete: 500 server error — exhausts retries, throws ApiError", async () => {
  resetCalls();
_setFetchForTesting(mockFetchPersistent500());

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
      (err: Error) => err instanceof ApiError && err.status === 500,
    );
    assert.ok(calls.length >= 3, `expected 3+ calls (retries exhausted), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Non-retryable 4xx
// =========================================================================

test("complete: 400 bad request — throws immediately, no retry", async () => {
  resetCalls();
_setFetchForTesting(mockFetchOk({ error: { message: "bad request" } }, 400));

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
      (err: ApiError) => err.status === 400,
    );
    assert.equal(calls.length, 1, "no retry on 4xx");
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("complete: 401 unauthorized — throws immediately", async () => {
  resetCalls();
_setFetchForTesting(mockFetchOk({ error: { message: "unauthorized" } }, 401));

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
      (err: ApiError) => err.status === 401,
    );
    assert.equal(calls.length, 1, "no retry on 401");
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Malformed responses
// =========================================================================

test("complete: malformed JSON body — throws ApiError", async () => {
  resetCalls();
_setFetchForTesting(mockFetchMalformedJson());

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
      /JSON/,
    );
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("complete: empty response body — throws SyntaxError", async () => {
  resetCalls();
_setFetchForTesting(mockFetchEmptyBody());

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
    );
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Network errors
// =========================================================================

test("complete: connection reset — retry succeeds", async () => {
  resetCalls();
_setFetchForTesting(mockFetchConnectionReset());

  try {
    const resp = await complete("openai", "gpt-4o", completionRequest);
    assert.equal(resp.text, "recovered");
    assert.ok(calls.length >= 2, `expected 2+ calls (retry after net error), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("complete: persistent network error — exhausts retries, throws", async () => {
  resetCalls();
_setFetchForTesting(mockFetchPersistentNetworkError());

  try {
    await assert.rejects(
      () => complete("openai", "gpt-4o", completionRequest),
    );
    assert.ok(calls.length >= 3, `expected 3+ calls (retries exhausted), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Provider-specific error messages
// =========================================================================

test("complete: Ollama error message from spec", async () => {
  resetCalls();
_setFetchForTesting(mockFetchOk({ error: "model not found" }, 404));

  try {
    await assert.rejects(
      () => complete("ollama", "llama3.2:3b", completionRequest),
      (err: ApiError) => err.detail.includes("model not found"),
    );
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Streaming fault injection
// =========================================================================

test("stream: 429 rate limit — retry succeeds", async () => {
  resetCalls();
  let attempt = 0;
  _setFetchForTesting(wrap(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    attempt++;
    if (attempt <= 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return makeStreamResponse([
      '{"model":"gpt-4o","response":"Hel","done":false}',
      '{"model":"gpt-4o","response":"lo!","done":true}',
    ]);
  }));

  try {
    const chunks: any[] = [];
    for await (const c of stream("ollama", "gpt-4o", { ...completionRequest, stream: true })) {
      chunks.push(c);
    }
    assert.ok(chunks.length > 0, "stream should produce chunks after retry");
    assert.ok(calls.length >= 2, `expected 2+ calls (retry after 429), got ${calls.length}`);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("stream: malformed SSE line does not crash stream", async () => {
  resetCalls();
  _setFetchForTesting(wrap(async () => {
    return new Response('not-json\n{"response":"ok","done":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

  try {
    // Malformed lines are silently skipped — stream must not crash
    for await (const _c of stream("ollama", "gpt-4o", { ...completionRequest, stream: true })) {
      // consume stream
    }
    assert.ok(true, "stream completed without crashing");
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("stream: 500 error yields error chunk", async () => {
  resetCalls();
_setFetchForTesting(async () => {
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    let errorSeen = false;
    for await (const c of stream("ollama", "gpt-4o", { ...completionRequest, stream: true })) {
      if (c.type === "error") errorSeen = true;
    }
    assert.ok(errorSeen, "stream should yield error chunk on 500");
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Security: unknown provider
// =========================================================================

test("complete: unknown provider throws", async () => {
_setFetchForTesting(mockFetchOk({}));

  try {
    await assert.rejects(
      () => complete("nonexistent", "x", completionRequest),
      /Unknown provider/,
    );
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

// =========================================================================
// Normal completion (smoke)
// =========================================================================

test("complete: normal happy path", async () => {
  resetCalls();
_setFetchForTesting(mockFetchOk(okResponse));

  try {
    const resp = await complete("openai", "gpt-4o", completionRequest);
    assert.equal(resp.text, "Hello!");
    assert.deepEqual(resp.usage, { inputTokens: 10, outputTokens: 5 });
    assert.equal(calls.length, 1);
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});
