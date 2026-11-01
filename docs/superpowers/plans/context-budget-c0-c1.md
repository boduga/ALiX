# Context Budget C0/C1 — Provider-aware Context Budget + observability

Build from spec **#456** (boduga/ALiX), the consolidating artifact of Wayfinder map **#448** (decision tickets #449–#455, each `## Resolution` comment is the contract). Six tickets, each independently verifiable. Two are frontier and parallelizable (Task 1, Task 4 — disjoint files); the rest chain on dependencies.

## Global Constraints

- **GitNexus gates (CLAUDE.md, non-negotiable):** BEFORE editing any function/class/method, run `impact({target, direction: "upstream"})` on it and report the blast radius. NEVER edit without impact. After changes, run `detect_changes({scope: "compare", base_ref: "main"})` before committing and confirm only expected symbols/flows are affected. Never rename symbols via find-and-replace. Warn the controller if impact returns HIGH/CRITICAL.
- **TDD:** write failing tests first (RED), confirm they fail for the expected reason, then implement (GREEN). Pure functions (estimator, budget factory, selector, preflight) are the TDD sweet spot.
- **Test seams (from spec, all three approved):** (1) pure-unit vitest for estimator/budget/selector/preflight; (2) projection-builder vitest on the `metrics-projection.vitest.ts` pattern (evt() fixture → update(events) → snapshot()); (3) task-loop integration vitest with real EventLog on a temp dir + mock provider, asserting the request the provider receives never exceeds the budget.
- **Only external behavior is tested** — admission outcomes, snapshot shapes, event payloads, the "no oversized request reaches provider" invariant. Never assert internal fields/plumbing.
- **Exact values (use verbatim):** safetyFactor **1.20**; reservation ratio **0.20**, floor **4,096**, cap **32,768**; tokenizer `o200k_base` for OpenAI-family, `cl100k_base` for all other providers; char/4 leaves the admission path.
- **No new dependencies** (no `@lenml`, no `@anthropic-ai/tokenizer`) in C0.
- **ContextBudget is immutable**; assembly consumes remaining available-input; eviction never mutates the projection snapshot.
- **`context.truncated` is superseded, NOT extended** (C1 semantics tie to the dead mechanism).
- Provider-reported usage is **telemetry only** — never fed back into the estimator/safety factor (no feedback controller).
- Full suite must stay green: `pnpm test:vitest` (696/696 baseline at e5396602).

## Task 1 — ModelDescriptor resolver + padded token estimator

**What to build:** Replace raw per-provider context resolution with an authoritative, cached `ModelDescriptor` and a single **padded token estimator** that becomes the sole admission estimator. Any caller resolving a model's window/tokenizer now gets one correctly-tagged, deterministic answer — the misspelled provider window finally resolves, and code-dense content can no longer silently undercount past the real window.

**Acceptance criteria:**
- [ ] Resolving a model's context limit returns `ModelDescriptor { provider, model, contextWindowTokens, tokenizer, safetyFactor }`, resolved once per process per model and cached; invalidated on model change.
- [ ] The descriptor's tokenizer is `o200k_base` for the OpenAI family and `cl100k_base` for all other providers; char/4 is no longer an admission estimator.
- [ ] The padded admission estimator is `ceil(baseTokenizerTokens × 1.20)`; its estimate is the budget-admission number, and estimation metadata (`{ tokenizer, rawEstimate, safetyFactor, budgetEstimate }`) is recorded for future C2 analysis.
- [ ] The misspelled provider key resolves to its intended 131k window instead of falling through to the 64k local default; the OpenAI-family model override is tagged `o200k_base`.
- [ ] Existing callers of the previous resolver/encoding helpers migrate to the descriptor, and the full suite stays green.

**Seam:** pure-unit vitest (estimator math, descriptor resolution, cache, both config bug fixes). Existing suite green.

## Task 2 — ContextBudget factory + pure preflight gate

**What to build:** The authoritative budget derivation and a pure preflight gate that proves any assembled request fits before it is sent. A caller can ask "does this assembled request fit?" and get a deterministic yes or a structured no — and an irreducible case raises a typed error instead of retrying an impossible request forever.

**Acceptance criteria:**
- [ ] From a ModelDescriptor, an immutable per-turn `ContextBudget { contextWindowTokens, reservedOutputTokens, availableInputTokens }` is derived with `reservedOutput = min(clamp(floor(window × 0.20), 4096, 32768), model.outputTokenLimit)`; ratio / floor / cap are config-overridable.
- [ ] Consumers receive the budget object, never a raw window number — no downstream half-window math can resurrect under another name.
- [ ] Preflight is pure and deterministic (no mutation, truncation, eviction, compaction, digest, provider call, retry, or hidden fallback) and returns `fits` or `overflow { overageTokens, byCategory }`.
- [ ] An irreducible case (mandatory core exceeds available input) raises a typed `ContextBudgetOverflowError` distinguishing *reducible* from *irreducible*.
- [ ] Unit tests cover budget shape across the window range (64k / 200k / 1M) and preflight fits / overflow / irreducible outcomes.

**Seam:** pure-unit vitest.

## Task 3 — Deterministic 6-tier greedy selector

**What to build:** Deterministic priority-first context assembly — the deliberately dumb selector that turns a candidate snapshot + budget into an admitted/dropped selection, reproducible across runs and retries.

**Acceptance criteria:**
- [ ] Assembly fills tiers in order — mandatory system/governance → current task → current execution state → recent conversation → recent tool results → older context — preserving source order and admitting whole items only.
- [ ] When the next whole item does not fit, it is skipped and assembly continues within the same tier (never drops the rest of that tier; never size-aware — a later smaller item is not preferred over a large earlier one).
- [ ] Tier 3 (execution-state: digest + ledger) is kept as a protected unit and fully token-accounted; if the mandatory region (tiers 1+2) does not fit, the irreducible error is raised.
- [ ] Each item carries provenance metadata (`category`, `kind`, `createdAt`, `source`) that the admission policy does not depend on.
- [ ] Assembly is one deterministic pass; preflight remains the final safety gate, not the selector's primary decision loop.

**Seam:** pure-unit vitest.

## Task 4 — ContextProjectionBuilder (context as an EventLog projection)

**What to build:** Make context another EventLog projection — an incremental builder on the existing projection seam (the same idempotent-by-seq, snapshot-producing contract as the timeline/metrics projections) that turns events into an immutable candidate-context snapshot. Context becomes provably "another projection," not a state-management layer.

**Acceptance criteria:**
- [ ] A `ContextProjectionBuilder` consumes EventLog batches incrementally with its own sequence cursor and produces an immutable `ContextProjectionSnapshot`:
  ```
  ContextProjectionSnapshot
  ├── executionState  { digest, ledger }     (Tier-3 composite)
  ├── conversation    { recentTurns, toolResults }
  └── provenance / sequence metadata
  ```
- [ ] Only context-relevant event families mutate the candidate (tool lifecycle/output, approval/governance, file/mutation, task/execution-state transitions); `model.usage` stays with the metrics projection; heartbeats, phase ticks, internal hooks, and unknown event types are ignored.
- [ ] Deltas derive from the event itself (`tool.completed → update()` updates the candidate directly) — never by re-scanning full history or rebuilding state.
- [ ] The projection is budget-agnostic: it never evicts (eviction belongs to budget-aware assembly) and assembling from a snapshot never mutates it — a small-budget invocation cannot destroy context a later larger-budget invocation could use.
- [ ] The new projection id is registered and the collector exposes its snapshot alongside the existing projections; existing projection-independence invariants stay green.

**Seam:** projection-builder vitest on the `metrics-projection.vitest.ts` pattern (evt() → update(events) → snapshot()); includes reset/immutability/independence checks. Runs parallel to Task 1 (disjoint files).

## Task 5 — Adopt budget + assembly + preflight in the loops

**What to build:** Wire the authoritative budget through the main model-loop path so **no oversized request ever reaches a provider** — provider limits are no longer discovered by failure. Reducible overflows reduce deterministically; irreducible overflows raise the typed error instead of killing the session.

**Acceptance criteria:**
- [ ] The task loop receives the `ContextBudget` object and drives assembly via the selector + preflight; the raw context limit and every half-window truncation are gone (the dead digest re-injection and the truncation-doesn't-persist closure bug die with it).
- [ ] The system prompt (repomap, memory, plan, skills) competes for the same available-input pool as messages — the context compiler re-budgets against the shared pool, no system-side exemption.
- [ ] `reservedOutputTokens` is sent to the provider as the explicit `maxOutputTokens`.
- [ ] A reducible overflow reduces deterministically and re-preflights before sending; an irreducible overflow raises the typed error before any provider call.
- [ ] Integration tests (mock provider, real event log) assert the request the provider receives never exceeds the budget and carries `maxOutputTokens`.

**Seam:** task-loop integration vitest (mock provider, real EventLog on tmpdir). Blocked by Tasks 1–4.

## Task 6 — C1 observability: lifecycle events + metrics counters + render classification

**What to build:** Make the context lifecycle observable — five correlated lifecycle events on the timeline plus a small bounded set of live counters, so an operator can watch "143k candidate → 96k budget → 91k admitted → 52k dropped." This is the instrumentation substrate C2 will analyze.

**Acceptance criteria:**
- [ ] Five lifecycle events emit at the right points: `context.snapshot.created` (once per actual model-facing invocation — never on internal projection updates, not throttled), `context.budget.computed`, `context.assembled` (admitted/dropped with category breakdown + drop reasons), `context.preflight.failed` (overage + byCategory), `context.irreducible`.
- [ ] `context.truncated` is superseded (no longer emitted); all five events share `invocationId` / `sessionId` / `projectionSeq` correlation metadata.
- [ ] The timeline projection admits the five events in narrative order.
- [ ] The metrics projection adds a bounded counter set — `contextWindowTokens`, `availableInputTokens`, `reservedOutputTokens`, `admittedTokens`, `droppedTokens`, derived `contextUtilization`% — with the same finite-value guard pattern as the existing counters, no lifecycle payload duplication.
- [ ] The Web/TUI render classifies context events by signal (`assembled` / `preflight.failed` / `irreducible` high-value; `snapshot.created` / `budget.computed` lower-signal and filterable).

**Seam:** projection/timeline vitest for events + counters, integration vitest for the five events landing with `invocationId`, render-classification test. Blocked by Tasks 4 and 5.
