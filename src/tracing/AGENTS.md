# src/tracing — Langfuse Tracing Facade (leaf module)

Purpose: the ALiX-owned tracing boundary. Exposes a single `TraceClient` facade — the only tracing API runtime seams ever see — backed (once later tasks land) by a Noop client and a Langfuse SDK adapter. ALiX owns what a trace means; Langfuse owns how it is transported. This module is observational only: it can enrich an execution but can never determine whether the execution succeeds or fails.

> Module status: **created in Task 3 (module boundary)** of `docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md`. Design contract: `docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md`. Only the type/interface boundary exists today; implementers below are added by later plan tasks.

## Ownership

| File | Responsibility | Status |
|------|----------------|--------|
| `types.ts` | ALiX-shaped inputs (`TraceRunInput`, `ModelSpanInput`, `ToolSpanInput`, `SpanOutcome`, `RunOutcome`), status vocab (`RunStatus`, `SpanStatus` = success/error/cancelled), opaque `TraceRun`/`TraceSpan` handles. Derived from `ExecutionContext` (src/observability), normalized provider request/response types (src/providers/types.ts), and `ToolCallRequest`/`CorrelationContext` fields (src/tools/types.ts, src/runtime/tool-correlation.ts). Never contains Langfuse SDK types. | **Task 3** |
| `client.ts` | `TraceClient` interface — the module boundary. Includes `getRun(runId)` for deep seams. | **Task 3** |
| `noop-client.ts` | `NoopTraceClient` — selected when tracing disabled or on construction failure (warn-once → Noop). | later task |
| `capture.ts` | Pure, copy-producing `CapturePolicy`: mandatory redaction BEFORE truncation; capture levels full/truncated/off. Redaction always enabled, non-disableable. | later task |
| `config.ts` | `TracingConfig` shape consumed at construction; `flushTimeoutMs` boundedness. Schema/defaults/deep-merge arms live in `src/config/`. | later task |
| `langfuse-client.ts` | Langfuse v3 adapter. **The ONLY file in the repo that may import `langfuse`.** Translates ALiX handles ↔ SDK objects internally; no SDK object/id/type ever escapes. | later task |

## Local Contracts

- **Dependency direction:** runtime seams (`src/agent`, `src/run`, `src/providers/provider-contract-validation.ts`, `src/tools/executor.ts`) import only `TraceClient` + types from this module. Nothing outside `langfuse-client.ts` imports `langfuse` or any provider SDK. Replacing Langfuse changes only the adapter, dependency, and config — never seams.
- **Leaf consumption of normalized runtime types:** `src/tracing/` may type-import existing ALiX identity/normalized shapes (`ExecutionContext`, `NormalizedMessage`, correlation ids) — type-only; it does not duplicate or re-own them. The existing `runId`/`sessionId`/`workflowId`/`parentRunId`/`invocationId`/`toolCallId`/`executionId` identity model remains authoritative. No second run identity, no second event/telemetry store.
- **Opaque handles:** `TraceRun`/`TraceSpan` are opaque; callers obtain them from `startRun`/`getRun`/`startModelSpan`/`startToolSpan` and pass them back. Langfuse trace/span/generation objects, SDK ids, and SDK types must never escape the adapter. Deep seams resolve a run via `getRun(runId)`; a null result means skip span creation.
- **One trace per runId:** `startRun` is idempotent per runId; `getRun(unknown)` → null; `endRun(unknown/ended)` → no-op; span end on an unknown/ended span → no-op. Lifecycle methods never throw into agent execution.
- **No network I/O from lifecycle methods:** `startRun`/`startModelSpan`/`startToolSpan`/`endSpan`/`endRun` enqueue/update local SDK state only. `flush()`/`shutdown()` are bounded by `flushTimeoutMs` and never change an ALiX run's outcome (fail-open: resolve/reject/timeout → continue).
- **Status vocab:** run + span statuses are `success` / `error` / `cancelled`. Timeouts/denials/failures map to `error`; operator cancellation maps to `cancelled` (matches ALiX activity terminal semantics).
- **Security:** capture applies mandatory redaction before truncation; `full` never means unredacted. No environment-variable credential resolution anywhere in the tracing path — keys use the existing `cred://` store mechanism.

## Work Guidance

- When adding a file here, keep it a leaf: import ALiX normalized runtime types type-only, and keep every public export free of SDK types.
- The `TraceClient` interface in `client.ts` is the contract every implementation must satisfy — do not grow it for one adapter's convenience; surface new needs through ALiX-shaped types.
- Follow the do-not-duplicate rule when adding capture/config: reuse existing normalized message/response/request shapes rather than inventing parallel ones, and reuse the existing secret-redaction prior art (src/policy/secret-scanner.ts, src/security/redaction/*) as reference — this module's detector is its own.
- Tests live in `tests/tracing/` (design §24) once implementations land.
- This file was created with the module; update it whenever a later task adds a file, changes a contract, or changes the DOX scope above.

## Verification

- Compile gate: `pnpm typecheck` and `pnpm build` must pass.
- No import of `langfuse` outside `langfuse-client.ts` (enforced by design; verify with a repo-wide search when the adapter lands).
- Tests (later): `pnpm vitest run tests/tracing --config vitest.config.mts` per design §25.

## Child DOX Index

None — `src/tracing/` is a leaf subsystem with no child AGENTS.md.
