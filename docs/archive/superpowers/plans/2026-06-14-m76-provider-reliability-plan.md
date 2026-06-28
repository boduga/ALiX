# M0.76 — Multi-Provider Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ALiX's provider runtime resilient to streaming mismatches, transient failures, and per-provider cost limits — with health checks, retry budgets with jitter, circuit breakers, profile-based failover, and comprehensive streaming regression tests across all providers.

**Architecture:** Add `streamFailures` and `healthCheckUrl` to `ProviderSpec`. Add a `CircuitBreaker` to `unified-complete.ts` that trips on consecutive failures. Add `fetchWithRetry` with exponential jitter to both `complete` and `stream`. Wire profile `fallbacks.cloud`/`fallbacks.local` into provider selection when the primary fails. Add `alix provider doctor` to test and report health for every configured provider. Add streaming regression tests using mock SSE/SSE-like endpoints for every provider spec.

**Tech Stack:** TypeScript, existing `ProviderSpec`, existing `unified-complete.ts`, existing profile fallback configuration, `node:test`.

---

## File Structure

### Create
- `src/providers/circuit-breaker.ts` — per-provider circuit breaker (closed/open/half-open, failure threshold, cooldown)
- `src/providers/provider-doctor.ts` — run a test completion and streaming round-trip for a provider
- `src/cli/commands/provider-doctor.ts` — `alix provider doctor` CLI
- `tests/providers/streaming-regression.test.ts` — test every provider spec's `fromStreamChunk` with real SSE lines
- `tests/providers/circuit-breaker.test.ts`
- `tests/providers/provider-doctor.test.ts`

### Modify
- `src/providers/spec-types.ts` — add optional `streamFailures` and `healthCheckUrl` fields
- `src/providers/unified-complete.ts` — integrate CircuitBreaker, add jittered retry to stream, use profile fallbacks
- `src/providers/registry.ts` — add provider health check method
- `src/cli.ts` — add `alix provider doctor` dispatch and help text
- `package.json` — add `test:provider` script

---

### Task 1: Circuit Breaker

**Files:**
- Create: `src/providers/circuit-breaker.ts`
- Create: `tests/providers/circuit-breaker.test.ts`

- [ ] **Step 1: Create circuit-breaker.ts**

```typescript
/**
 * circuit-breaker.ts — Per-provider circuit breaker.
 *
 * States: closed (normal), open (failing — fast-fail), half-open (probing).
 * Transitions: consecutive failures → open, cooldown timeout → half-open,
 * successful probe → closed.
 */

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitOptions = {
  failureThreshold?: number;   // consecutive failures to trip (default 3)
  cooldownMs?: number;         // time before half-open probe (default 30s)
};

const DEFAULTS = { failureThreshold: 3, cooldownMs: 30000 };

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private opts: Required<CircuitOptions>;

  constructor(opts: CircuitOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  getState(): CircuitState { return this.state; }

  /** Call before each request. Throws if circuit is open. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.opts.cooldownMs) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open — provider unavailable");
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e: any) {
      this.onFailure();
      throw e;
    }
  }

  onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "half-open") this.state = "closed";
  }

  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.opts.failureThreshold) {
      this.state = "open";
    }
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
  }
}
```

- [ ] **Step 2: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../../src/providers/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    assert.equal(new CircuitBreaker().getState(), "closed");
  });

  it("trips to open after failureThreshold failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60000 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "half-open"); // 1 failure, not yet open
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "open"); // 2 failures → open
  });

  it("throws immediately when open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    await assert.rejects(() => cb.call(() => Promise.resolve("ok")), /Circuit breaker is open/);
  });

  it("half-open probe success transitions to closed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "open");
    await new Promise(r => setTimeout(r, 5)); // past cooldown
    const result = await cb.call(() => Promise.resolve("probe ok"));
    assert.equal(result, "probe ok");
    assert.equal(cb.getState(), "closed");
  });

  it("reset restores closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    cb.onFailure();
    assert.equal(cb.getState(), "open");
    cb.reset();
    assert.equal(cb.getState(), "closed");
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/providers/circuit-breaker.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/providers/circuit-breaker.ts tests/providers/circuit-breaker.test.ts
git commit -m "feat(providers): add per-provider circuit breaker with state machine"
```

---

### Task 2: Streaming Regression Tests

**Files:**
- Create: `tests/providers/streaming-regression.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * streaming-regression.test.ts — Verify every provider spec's stream
 * chunk parser handles real SSE/SSE-like responses correctly.
 *
 * Tests focus on fromStreamChunk — no HTTP calls, no real API keys.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleSpec } from "../../src/providers/specs/google-spec.js";
import { openaiSpec } from "../../src/providers/specs/openai-spec.js";
import { anthropicSpec } from "../../src/providers/specs/anthropic-spec.js";
import { ollamaSpec } from "../../src/providers/specs/ollama-spec.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";
import { groqSpec } from "../../src/providers/specs/groq-spec.js";
import { perplexitySpec } from "../../src/providers/specs/perplexity-spec.js";
import { minimaxSpec } from "../../src/providers/specs/minimax-spec.js";
import { zhipuaiSpec } from "../../src/providers/specs/zhipuai-spec.js";
import { grokaiSpec } from "../../src/providers/specs/grokai-spec.js";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import type { ProviderSpec } from "../../src/providers/spec-types.js";

// All specs that support streaming
const STREAMING_SPECS: [string, ProviderSpec][] = [
  ["google", googleSpec],
  ["openai", openaiSpec],
  ["anthropic", anthropicSpec],
  ["ollama", ollamaSpec],
  ["deepseek", deepseekSpec],
  ["groq", groqSpec],
  ["perplexity", perplexitySpec],
  ["minimax", minimaxSpec],
  ["zhipuai", zhipuaiSpec],
  ["grokai", grokaiSpec],
  ["openrouter", openrouterSpec],
];

// Real SSE line patterns each provider sends
const TEST_CASES: Record<string, { line: string; expectedType: string; expectedText?: string }[]> = {
  google: [
    { line: 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}', expectedType: "text_delta", expectedText: "Hello" },
    { line: ": keepalive", expectedType: "null" },
    { line: "data: [DONE]", expectedType: "null" },
  ],
  openai: [
    { line: 'data: {"choices":[{"delta":{"content":"Hello"}}]}', expectedType: "text_delta", expectedText: "Hello" },
    { line: "data: [DONE]", expectedType: "null" },
    { line: ": keepalive", expectedType: "null" },
  ],
  anthropic: [
    { line: 'data: {"type":"content_block_delta","delta":{"text":"Hello"}}', expectedType: "text_delta", expectedText: "Hello" },
  ],
};

describe("streaming regression", () => {
  for (const [name, spec] of STREAMING_SPECS) {
    it(`${name} fromStreamChunk handles text_delta`, () => {
      const cases = TEST_CASES[name] || [
        { line: 'data: {"type":"text","content":"Hello"}', expectedType: "text_delta", expectedText: "Hello" },
      ];
      for (const tc of cases) {
        const result = spec.fromStreamChunk(tc.line);
        if (tc.expectedType === "null") {
          assert.equal(result, null, `${name}: ${tc.line} should return null`);
        } else if (result && result.type === "text_delta") {
          if (tc.expectedText !== undefined) assert.equal(result.text, tc.expectedText, `${name}: text mismatch`);
        }
      }
    });

    it(`${name} fromStreamChunk returns null for empty/heartbeat lines`, () => {
      assert.equal(spec.fromStreamChunk(""), null);
      assert.equal(spec.fromStreamChunk(": keepalive"), null);
      assert.equal(spec.fromStreamChunk("data:"), null);
    });
  }
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build && node --test dist/tests/providers/streaming-regression.test.js
```

- [ ] **Step 3: Commit**

```bash
git add tests/providers/streaming-regression.test.ts
git commit -m "test(providers): add streaming regression tests for all provider specs"
```

---

### Task 3: Retry Budget with Jitter for Stream

**Files:**
- Modify: `src/providers/unified-complete.ts`

- [ ] **Step 1: Add jittered retry to stream**

The `stream` function currently has no retry — a single HTTP 429 or 5xx kills the stream. Add retry with jitter before the initial fetch:

```typescript
export async function* stream(
  provider: string,
  model: string,
  request: NormalizedRequest,
  options: { apiKey?: string } = {}
): AsyncGenerator<StreamChunk> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = resolveApiKey(provider, options.apiKey);
  const body = spec.toRequestBody({ ...request, model, stream: true });
  const streamBase = spec.streamUrl ?? spec.baseUrl;
  const url = streamBase.replace("{model}", encodeURIComponent(model));

  const maxRetries = 2;
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await _fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const delay = Math.floor(Math.random() * 1000 * Math.pow(2, attempt));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        const errBody = await res.json().catch(() => ({}));
        yield { type: "error", error: spec.toErrorMessage(res.status, errBody) };
        return;
      }

      // Stream the response body — same as before
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const chunk = spec.fromStreamChunk(line.trim());
          if (chunk) yield chunk;
        }
      }
      return; // success — exit the retry loop

    } catch (e: any) {
      lastError = e.message;
      if (attempt < maxRetries) {
        const delay = Math.floor(Math.random() * 1000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      yield { type: "error", error: lastError || "Stream failed" };
      return;
    }
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/unified-complete.ts
git commit -m "feat(providers): add jittered retry to stream function (was missing entirely)"
```

---

### Task 4: Provider Doctor CLI

**Files:**
- Create: `src/providers/provider-doctor.ts`
- Create: `src/cli/commands/provider-doctor.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create provider-doctor.ts**

```typescript
/**
 * provider-doctor.ts — Run a test completion and streaming round-trip
 * for a provider. Verifies that the provider responds, returns valid
 * output, and (if supported) streams text deltas.
 */

import { complete, stream } from "./unified-complete.js";

export type ProviderHealthResult = {
  provider: string;
  model: string;
  hasApiKey: boolean;
  completeOk: boolean;
  streamOk: boolean | "unsupported";
  durationMs: number;
  error?: string;
};

const TEST_PROMPT = 'Respond with exactly one word: "ok"';

export async function checkProvider(
  provider: string,
  model: string,
  apiKey: string,
): Promise<ProviderHealthResult> {
  const start = Date.now();
  const result: ProviderHealthResult = { provider, model, hasApiKey: !!apiKey, completeOk: false, streamOk: false, durationMs: 0 };

  if (!apiKey) {
    result.completeOk = false;
    result.streamOk = false;
    result.durationMs = Date.now() - start;
    result.error = "No API key configured";
    return result;
  }

  const opts = { apiKey };

  // Test complete
  try {
    const response = await complete(provider, model, { messages: [{ role: "user", content: TEST_PROMPT }] }, opts);
    result.completeOk = !!response.text;
  } catch (e: any) {
    result.completeOk = false;
    if (!result.error) result.error = `Complete failed: ${e.message}`;
  }

  // Test stream
  try {
    let sawText = false;
    for await (const chunk of stream(provider, model, { messages: [{ role: "user", content: TEST_PROMPT }] }, opts)) {
      if (chunk.type === "text_delta" && chunk.text) sawText = true;
      if (chunk.type === "error") throw new Error(chunk.error);
    }
    result.streamOk = sawText;
  } catch (e: any) {
    result.streamOk = false;
    if (!result.error) result.error = `Stream failed: ${e.message}`;
  }

  result.durationMs = Date.now() - start;
  return result;
}
```

- [ ] **Step 2: Create the CLI handler**

```typescript
/**
 * provider-doctor.ts — CLI commands for provider diagnostics.
 *
 * alix provider doctor              Check all configured providers
 * alix provider doctor google       Check a specific provider
 */

import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";

export async function handleProviderDoctor(args: string[]): Promise<void> {
  const config = await loadConfig(process.cwd());
  const providerFilter = args[0]?.toLowerCase();
  const jsonMode = args.includes("--json");

  const { PROVIDER_KEY_ENV } = await import("../../providers/unified-complete.js");
  const { checkProvider } = await import("../../providers/provider-doctor.js");

  // Gather configured providers
  const providers: { id: string; model: string }[] = [];
  const mainProvider = config.model.provider;
  const mainModel = config.model.name;
  providers.push({ id: mainProvider, model: mainModel });

  // Also check profiling configurations from config.models
  if (config.models) {
    for (const [role, m] of Object.entries(config.models)) {
      if (m.provider && !providers.find(p => p.id === m.provider)) {
        providers.push({ id: m.provider, model: m.name });
      }
    }
  }

  const results = [];
  for (const p of providers) {
    if (providerFilter && p.id !== providerFilter) continue;
    const envVar = (PROVIDER_KEY_ENV as Record<string, string>)[p.id] || "";
    const apiKey = config.apiKeys?.[p.id] || process.env[envVar] || "";
    const result = await checkProvider(p.id, p.model, apiKey);
    results.push(result);
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let allOk = true;
  for (const r of results) {
    const icon = r.hasApiKey ? (r.completeOk ? "✅" : "❌") : "⏸";
    const streamIcon = r.streamOk === true ? "✅" : r.streamOk === false ? "❌" : "—";
    console.log(`${icon} ${r.provider}/${r.model}`);
    console.log(`   API key: ${r.hasApiKey ? "✓" : "✗"}`);
    console.log(`   Complete: ${r.completeOk ? "✓" : "✗"}  Stream: ${streamIcon}`);
    if (r.error) console.log(`   Error: ${r.error}`);
    if (!r.completeOk) allOk = false;
    console.log();
  }

  if (!allOk) process.exit(1);
}
```

- [ ] **Step 3: Add dispatch and help text in src/cli.ts**

Add:
```typescript
if (command === "provider" && args[0] === "doctor") {
  const { handleProviderDoctor } = await import("./cli/commands/provider-doctor.js");
  await handleProviderDoctor(args.slice(1));
}
```

Add help text:
```
  alix provider doctor       Test all configured providers (complete + stream)
  alix provider doctor google  Test a specific provider
```

- [ ] **Step 4: Build and smoke test**

```bash
npm run build && node dist/src/cli.js provider doctor --json
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/provider-doctor.ts src/cli/commands/provider-doctor.ts src/cli.ts
git commit -m "feat(providers): add provider doctor CLI with complete+stream round-trip check"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/providers/circuit-breaker.test.js` — all pass
3. `node --test dist/tests/providers/streaming-regression.test.js` — all pass
4. `node dist/src/cli.js provider doctor --json` — returns health for all configured providers
5. `node dist/src/cli.js provider doctor google` — checks Google specifically
6. All existing tests pass (`npm run test:node:ci`)
