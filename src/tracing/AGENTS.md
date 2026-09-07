# src/tracing — Langfuse Tracing Facade (leaf module)

Purpose: the ALiX-owned tracing boundary. Exposes a single `TraceClient` facade — the only tracing API runtime seams ever see — backed (once later tasks land) by a Noop client and a Langfuse SDK adapter. ALiX owns what a trace means; Langfuse owns how it is transported. This module is observational only: it can enrich an execution but can never determine whether the execution succeeds or fails.

> Module status: **module boundary (Task 3), NoopTraceClient (Task 4), capture policy (Task 5), Langfuse adapter (Task 7)** of `docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md`. Design contract: `docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md`. Types/interface, inert no-op client, pure capture policy, and the Langfuse v3 adapter exist today; config lives in `src/config/` (Task 6); factory + wiring are added by later plan tasks.

## Ownership

| File | Responsibility | Status |
|------|----------------|--------|
| `types.ts` | ALiX-shaped inputs (`TraceRunInput`, `ModelSpanInput`, `ToolSpanInput`, `SpanOutcome`, `RunOutcome`), status vocab (`RunStatus`, `SpanStatus` = success/error/cancelled), opaque `TraceRun`/`TraceSpan` handles. Derived from `ExecutionContext` (src/observability), normalized provider request/response types (src/providers/types.ts), and `ToolCallRequest`/`CorrelationContext` fields (src/tools/types.ts, src/runtime/tool-correlation.ts). Never contains Langfuse SDK types. | **Task 3** |
| `client.ts` | `TraceClient` interface — the module boundary. Includes `getRun(runId)` for deep seams. | **Task 3** |
| `noop-client.ts` | `NoopTraceClient` (class + frozen `NOOP_TRACE_CLIENT` singleton) — inert implementation of the full `TraceClient`, selected when tracing disabled or on construction failure (warn-once → Noop). No SDK import, no credential resolution, no network I/O, no per-span allocation. | **Task 4** |
| `capture.ts` | Pure, copy-producing capture policy: mandatory redaction BEFORE truncation; capture levels `full`/`truncated`/`off`. Exports `CaptureLevel`, `CaptureLimits`, `REDACTED`, `redactString`, `captureString`, `captureValue`, `captureMessages`, `captureToolArgs`. No Langfuse dependency; `off` → `undefined`. Redaction always enabled, non-disableable. | **Task 5** |
| `config.ts` | No module-local config file. `TracingConfig` shape lives in `src/config/schema.ts` (Task 6) with defaults/deep-merge arms in `src/config/`; the adapter type-imports it (`type TracingConfig`) — single source of truth stays in `src/config/`. | **Task 6** |
| `langfuse-client.ts` | Langfuse v3 adapter (`LangfuseTraceClient implements TraceClient`). **The ONLY file in the repo that may import `langfuse`.** Translates ALiX handles ↔ SDK objects internally (runId → Langfuse trace id; model span → generation; tool span → span); no SDK object/id/type ever escapes. Enforces the active-run registry, terminal span state, unknown-run noop spans, capture-before-SDK, and fail-open lifecycle (design §3/§11-12/§14/§18-21). | **Task 7** |
| `tests/tracing/langfuse-client.vitest.ts` | Adapter tests against a `vi.mock('langfuse')` fake (no network): one-trace-per-runId, registry resolution, lifecycle idempotency, noop spans, capture redaction/truncation reaching the SDK, outcome translation, flush/shutdown delegation, never-throw on SDK errors, construction validation. | **Task 7** |

## Local Contracts

- **Dependency direction:** runtime seams (`src/agent`, `src/run`, `src/providers/provider-contract-validation.ts`, `src/tools/executor.ts`) import only `TraceClient` + types from this module. Nothing outside `langfuse-client.ts` imports `langfuse` or any provider SDK. Replacing Langfuse changes only the adapter, dependency, and config — never seams.
- **Leaf consumption of normalized runtime types:** `src/tracing/` may type-import existing ALiX identity/normalized shapes (`ExecutionContext`, `NormalizedMessage`, correlation ids) — type-only; it does not duplicate or re-own them. The existing `runId`/`sessionId`/`workflowId`/`parentRunId`/`invocationId`/`toolCallId`/`executionId` identity model remains authoritative. No second run identity, no second event/telemetry store.
- **Opaque handles:** `TraceRun`/`TraceSpan` are opaque; callers obtain them from `startRun`/`getRun`/`startModelSpan`/`startToolSpan` and pass them back. Langfuse trace/span/generation objects, SDK ids, and SDK types must never escape the adapter. Deep seams resolve a run via `getRun(runId)`; a null result means skip span creation.
- **One trace per runId:** `startRun` is idempotent per runId; `getRun(unknown)` → null; `endRun(unknown/ended)` → no-op; span end on an unknown/ended span → no-op. Lifecycle methods never throw into agent execution.
- **No network I/O from lifecycle methods:** `startRun`/`startModelSpan`/`startToolSpan`/`endSpan`/`endRun` enqueue/update local SDK state only. `flush()`/`shutdown()` are bounded by `flushTimeoutMs` and never change an ALiX run's outcome (fail-open: resolve/reject/timeout → continue).
- **Status vocab:** run + span statuses are `success` / `error` / `cancelled`. Timeouts/denials/failures map to `error`; operator cancellation maps to `cancelled` (matches ALiX activity terminal semantics).
- **Security:** capture applies mandatory redaction before truncation; `full` never means unredacted. Redaction is always enabled and cannot be disabled through configuration or the capture surface. The detector is best-effort and non-exhaustive — callers remain responsible for not intentionally supplying sensitive data for capture. No environment-variable credential resolution anywhere in the tracing path — keys use the existing `cred://` store mechanism.
- **Capture levels & `off`:** capture level `"off"` returns `undefined` from every capture function — facade callers treat `undefined` as "field omitted". `"full"` = full value after mandatory redaction (never bypasses redaction); `"truncated"` = redaction then truncation per `CaptureLimits`. All capture functions return copies; caller-owned inputs are never mutated.

## Work Guidance

- When adding a file here, keep it a leaf: import ALiX normalized runtime types type-only, and keep every public export free of SDK types.
- The `TraceClient` interface in `client.ts` is the contract every implementation must satisfy — do not grow it for one adapter's convenience; surface new needs through ALiX-shaped types.
- Follow the do-not-duplicate rule when adding capture/config: reuse existing normalized message/response/request shapes rather than inventing parallel ones, and reuse the existing secret-redaction prior art (src/policy/secret-scanner.ts, src/security/redaction/*) as reference — this module's detector is its own and deliberately non-exhaustive.
- Capture helpers: message arrays and tool args pass through `captureValue`/`captureMessages`/`captureToolArgs` (redaction + structural truncation on copies); output/reasoning text passes through `captureString`. Do not build a capture path that bypasses `redactString` or re-orders redaction before truncation.
- Tests live in `tests/tracing/` (design §24). Capture policy tests: `tests/tracing/capture.vitest.ts`; adapter tests: `tests/tracing/langfuse-client.vitest.ts`.
- This file was created with the module; update it whenever a later task adds a file, changes a contract, or changes the DOX scope above.

## Verification

- Compile gate: `pnpm typecheck` and `pnpm build` must pass.
- No import of `langfuse` outside `langfuse-client.ts` (enforced by design; verify with a repo-wide search when the adapter lands).
- Focused test gate: `pnpm vitest run tests/tracing --config vitest.config.mts` per design §25.

## Child DOX Index

None — `src/tracing/` is a leaf subsystem with no child AGENTS.md.
