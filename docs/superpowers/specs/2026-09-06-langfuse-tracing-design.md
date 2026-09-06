# Design — Langfuse Tracing for ALiX

Date: 2026-09-06
Status: Approved for implementation (pending written-spec review)
Scope owner: `src/tracing/`

## Summary

Instrument ALiX agent execution with Langfuse tracing, exporting one Langfuse
trace per ALiX `runId` with model and tool spans, following Langfuse best
practices. ALiX owns observability semantics; Langfuse owns Langfuse transport
mechanics.

## Locked decisions

1. **Approach A**: official `langfuse` SDK (v3) behind a thin, ALiX-owned
   `TraceClient` facade. The Langfuse adapter is the **only** file that imports
   the SDK. Replacing Langfuse later touches exactly one file.
2. **Trace granularity**: exactly one Langfuse trace per ALiX `runId`. Turns,
   model calls, and tool calls are spans *within* that trace.
3. **Instrumentation mechanism**: inline spans created at three seams, exported
   asynchronously (SDK batching). Enqueue is cheap; `flush()` is bounded.
4. **Surface scope**: all agent runs **and** chat turns (uniform coverage via
   the shared seams).

## 1. Architecture

```
ALiX seams                          TraceClient facade              langfuse SDK v3
──────────────                      ─────────────────              ───────────────
runTaskCore / processTurn / processChat ─▶ startRun ─┐
withProviderContracts ──────▶ model span │  TraceClient  ──▶  LangfuseClient ──▶ Langfuse
ToolExecutor.execute ───────▶ tool span  ┘  (ALiX-owned)   (adapter owns nothing
                                                             but SDK construction)
```

- New leaf module `src/tracing/` with its own `AGENTS.md`.
- Instrumentation sites hold a `TraceClient`; they never know Langfuse exists.
- **`src/tracing/` must not become a second observability/event system.** It
  consumes existing runtime identities (`runId`, `sessionId`, `workflowId`,
  `parentRunId`, `invocationId`, `toolCallId`, `ExecutionContext`) and existing
  normalized types. It invents no competing run identity and no competing event
  store.
- Adapter constructs the SDK from config; all other tracing files depend only
  on the facade interface and the SDK's exported types at the adapter boundary.

## 2. `TraceClient` interface

The facade is deliberately smaller than the Langfuse API — it exposes only what
ALiX needs:

```ts
interface TraceClient {
  startRun(input: TraceRunInput): TraceRun;
  startModelSpan(run: TraceRun, input: ModelSpanInput): TraceSpan;
  startToolSpan(run: TraceRun, input: ToolSpanInput): TraceSpan;
  endSpan(span: TraceSpan, outcome: SpanOutcome): void;
  endRun(run: TraceRun, outcome: RunOutcome): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

Input types are ALiX-shaped (`runId`, `sessionId`, `workflowId`, `parentRunId`,
model/`resolvedModel`, usage, tool name/args/output, timestamps). The Langfuse
object (trace/span/generation) lives inside the adapter and never leaks to
callers; `TraceRun`/`TraceSpan` are opaque handles.

The facade maintains an **active-run registry** keyed by `runId`:
`startRun` registers it, `endRun` unregisters it. `startModelSpan` /
`startToolSpan` carry a `runId` in their input and the facade resolves the
`TraceRun`; an unknown `runId` resolves to a no-op span (never throws). This is
what lets the deep seams (which see only `ExecutionContext` fields, not a
`TraceRun` handle) attach spans to the correct trace without the facade or the
seams knowing Langfuse.

### Contracts

- `endSpan()`/`endRun()` are **synchronous from the caller's perspective and
  MUST NOT perform network I/O** — they enqueue locally (or no-op on the Noop
  client). Only `flush()` awaits SDK transport.
- `endRun()` is explicit: `startRun → spans → endRun → flush`. The facade owns
  trace semantics; "flush" never implicitly means "run completed". The adapter
  translates `endRun()` into the appropriate SDK trace update.
- Noop client is chosen **once** at construction (`enabled → LangfuseClient`,
  `disabled/failed → NoopTraceClient`). Instrumentation seams carry **zero
  per-event branch cost** — no repeated `if (config.tracing.enabled)` checks.

## 3. Data minimization & redaction

Captured payloads pass through a pure `CapturePolicy` (`src/tracing/capture.ts`)
that returns **copies** — instrumented objects are never mutated.

### Pipeline order (security-critical)

```
raw value
   ↓
redaction     ← built-in, ALiX-owned, NON-DISABLEABLE
   ↓
truncation    ← configurable limits
   ↓
capture
```

Redaction runs **before** truncation so a credential cannot be cut across a
truncation boundary and evade a regex.

### Built-in redaction (always on, non-disableable)

Best-effort regex redaction of common secret shapes: `sk-`/`pk-` tokens,
`api[_-]?key`/`apikey` assignment, `Authorization:` and `Bearer <token>`,
`cred://<provider>/<key>` references, PEM blocks
(`-----BEGIN … KEY-----`), OpenAI/Langfuse-style key prefixes. Replaced with
`<redacted>`.

Boundary note (documented, not code): capture policy provides best-effort
built-in secret redaction; **callers remain responsible for not sending
intentionally sensitive data**. This is not an exhaustive secret detector.

### Capture levels (configurable)

| data | default | notes |
|---|---|---|
| model input messages | `truncated` | per-message + count caps |
| model output text | `truncated` | |
| model `reasoning` | `off` | private trace — large & sensitive; explicit opt-in |
| tool input args | `truncated` | |
| tool output preview | `truncated` | shell/fs output is the riskiest channel |

Configuration controls **what** is captured and **how much**; it never controls
**whether known secrets are redacted**.

## 4. Configuration

New top-level `tracing` section in user/project config. Neutral example:

```json
"tracing": {
  "enabled": false,
  "langfuse": {
    "baseUrl": "http://langfuse.example:3000",
    "publicKey": "cred://langfuse/publicKey",
    "secretKey": "cred://langfuse/secretKey"
  },
  "capture": {
    "messages": "truncated",
    "reasoning": "off",
    "toolInput": "truncated",
    "toolOutput": "truncated",
    "maxMessageChars": 4000,
    "maxToolOutputChars": 2000
  },
  "flushTimeoutMs": 2000
}
```

- **Schema**: `TracingConfig` added to `src/config/schema.ts`; deep-merge arm
  added to `mergeConfig` in `src/config/loader.ts` (nested `tracing` would
  otherwise be a shallow top-level replace).
- **Credentials**: both keys use the `cred://langfuse/<keyLabel>` credential
  reference mechanism (matching the already-stored `langfuse/publicKey` and
  `langfuse/secretKey`); **neither is resolved from environment variables**.
  Secret key belongs in the credential store; public key rides the same uniform
  store-only mechanism by the same rule.
- **No SDK-tuning knobs in ALiX config**: `debug` and `flushIntervalMs` are not
  exposed. The facade prefers ALiX semantic config. The one SDK-adjacent knob
  kept is `flushTimeoutMs` because ALiX genuinely needs a boundedness contract.
- **Defaults**: `enabled:false`; nothing is constructed or exported unless
  explicitly enabled.

### Failure & performance contract (lock-in)

> Tracing must never fail or materially block agent execution. Network
> failures, SDK failures, and shutdown flushing are bounded and isolated from
> the agent run.

- Enqueue path is cheap/non-blocking (Section 2 contract).
- **Bounded flush**: `flush()` at run end is awaited under `flushTimeoutMs`
  (default 2000). If the SDK flush exceeds the bound or throws, ALiX discards
  the pending flush, warns once, and continues — the agent result is unchanged.
- Any construction-time failure (bad config, unresolvable keys) or mid-run SDK
  error → warn once, fall back to `NoopTraceClient` for the rest of the
  process. Tracing faults can never fail, crash, or hang an agent run.

## 5. Seam wiring

### Run/turn identity rule (lock-in)

> **Exactly one Langfuse trace corresponds to exactly one ALiX `runId`; turns
> and model/tool calls are spans within that trace. Chat turns, which have no
> native `runId`, synthesize one per `processChat` invocation so the rule holds
> uniformly.**

The three root wrappers are **alternative** top-level entry points — all three
reach `runTaskLoop` or the provider directly and never nest within one another:
- `processTurn` (`src/agent/session.ts`, runId assigned ~L1336) — session-rooted
  task turns: `alix run`, REPL, TUI agent tab.
- `runTask`/`runTaskCore` (`src/agent/agent-loop.ts`, runId assigned ~L339) —
  task-rooted flows: daemon, CLI research, issue/PR runs, kernel graph nodes.
- `processChat` (`src/agent/session.ts` ~L2017) — interactive chat turns. Chat
  has no `runId` today; each `processChat` invocation synthesizes one
  (`run-<uuid8>`, same scheme as the other roots) and threads an
  `ExecutionContext` carrying it into the `provider.complete` request so the
  model-span seam can resolve the trace. Its continuation re-prompt (~L2079)
  reuses the same synthesized `runId` → same trace, one model span per physical
  call.

Trace creation/teardown:
- `startRun` immediately after the runId is assigned/synthesized in whichever
  root wrapper entered; `endRun` in the existing terminal path (`task.done/
  failed`, turn.completed, chat return, incl. `finally`), then bounded `flush()`.
- Session-level grouping is **metadata, not structure**: `sessionId` and
  `workflowId` are trace attributes/inputs so multiple run traces group into one
  session/project view in Langfuse.

### Model span

Inside `withProviderContracts` (`src/providers/provider-contract-validation.ts`)
— the single wrapper applied to every adapter by `createProvider`. Covers
completion, streaming, plan/classifier/chat calls, retries/free-route fallback.

Invariants:
- **Exactly one model span per provider request**, regardless of chunk count.
  Span starts at request initiation and ends exactly once when the stream
  terminates (success or error) — never one span per chunk.
- Capture: truncated input/output through `CapturePolicy`; tag `provider`,
  `model`/`resolvedModel`, usage (`inputTokens`, `outputTokens`), `finishReason`;
  `reasoning` only when `capture.reasoning != "off"`.
- A single logical answer that is split across physical provider calls
  (truncation continuation, free-route retry) yields one model span per physical
  call, correlated by `invocationId` attribute.

### Tool span

Inside `ToolExecutor.execute` (`src/tools/executor.ts`), around router
execution. Invariants:
- **Exactly one terminal tool span per tool call** — success, failure, timeout,
  or cancellation all end exactly once with the correct status.
- Capture truncated args + output preview; tag `toolName`, capability,
  `toolCallId`/`invocationId`/`executionId`, `durationMs`.
- Parallel tool calls are **sibling spans** under the same trace — never
  parent/child merely because they execute in the same scheduler batch.

### Subagent linkage

ALiX `parentRunId` links a child trace to its parent trace. The facade owns the
translation:

```
ALiX parentRunId
        ↓
TraceClient
        ↓
Langfuse parent/trace relationship
```

Instrumentation layers never construct Langfuse-specific linkage IDs.

## 6. Testing

Pure units and adapter/wiring tests under `tests/tracing/` (vitest):

1. **CapturePolicy**: levels `full/truncated/off`; returns copies (no mutation);
   built-in redaction shapes.
2. **Redaction before truncation**: a secret placed exactly at the truncation
   boundary is still redacted (validates the security ordering, not just
   obvious strings).
3. **Adapter**: fake SDK injected → assert adapter issues correct SDK calls and
   the facade never leaks SDK types to callers.
4. **Wiring, enabled**: mock-provider run with a fake SDK → assert exactly
   trace (1) + model spans + tool spans + run/turn grouping + `parentRunId`
   linkage.
5. **Wiring, disabled/misconfigured**: `NoopTraceClient`, zero SDK calls,
   fail-open on bad keys.
6. **Exactly-once model span**: streaming `1 request → 1 model span` regardless
   of chunk count.
7. **Exactly-once tool span**: success / throw / timeout / cancellation each
   produce exactly one terminal span.
8. **Flush timeout**: SDK flush hangs → timeout → agent run remains successful
   (proves the bounded-flush fail-open contract).

Verification: `pnpm build` (typecheck) and `pnpm vitest run tests/tracing`
must be green.

## Non-goals

- No second event/observability system (Section 1).
- No Langfuse eval/prompt-management features in this change.
- No export of ALiX's own persisted telemetry into Langfuse beyond what the
  seams capture.
- No environment-variable key resolution anywhere in the tracing path.
