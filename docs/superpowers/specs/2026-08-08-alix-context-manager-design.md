# ALiX Context Manager — Design Addendum (C0/C1 Review Follow-up)

**Date:** 2026-08-08
**Status:** Approved design → spec
**Relates to:** Phase C0 (instrument overflow as observed failure mode before budgeting infra), open `estimateTokens` question, context rot as first-class metric
**Scope:** `context-limits.ts`, `context-budget.ts`, `context-assembly.ts`, `task-loop.ts`, `run.ts`, `events/types.ts`, `validator.ts`

## Problem

The shipped C0/C1 budget-and-assembly pipeline resolves a model's context window,
derives an authoritative per-turn budget, estimates each item's padded token cost,
and admits items into a 6-tier assembly with a typed irreducible-overflow escape
hatch. Five review findings identify where the pipeline is assumption-driven
rather than measurement-driven, plus one correctness bug (inverted recency) in
the admission order. This addendum captures the resulting design changes.

| Finding | Verdict |
|---|---|
| §1 Uniform 1.2× safety factor compensates for unmeasured tokenizer mismatch | Real — instrument before trusting |
| §2 All tool schemas unconditional Tier-1, no per-task scoping | Real — highest-risk growth point |
| §3 No feedback from drops to downstream failure signals | Real — joins two signal families never joined |
| §4 Within-tier ordering unspecified | **Bug, not doc gap** — code admits OLDEST-first |
| §5 `reservedOutputTokens` conflates budget-planning and generation-length knobs | Partially — coupling is defensible; decoupling is a config-surface ask |
| §6 Context-rot threshold | Deferred — must be learned from §3 data, not guessed |

## Decision summary

| Decision | Choice |
|---|---|
| §1 Tokenizer calibration | Per-provider `providerCalibration` map, p95(actual/raw), persisted to `~/.alix/calibration.json`; replaces global 1.2 after burn-in |
| §2 Tool scoping | T1a/T1b split + pre-classification relevance filter + **shed-tool re-scope via existing scope-expansion retry path** |
| §3 `contextPressure` | Aggregate + peak snapshot on `RunResult`, persisted to EventLog; `iterationsSincePeak` derived free |
| §4 Recency | **Fix admitted to newest-first (urgent, self-contained)**; `tierOrderingStrategy` config surface (mechanical, later) |
| §5 Knob split | `budgetReservation` vs `requestedMaxOutputTokens`, invariant `requestedMax ≤ budgetReservation`; single new config key `context.budget.maxOutputTokens` |
| §6 Threshold | Learned from §3 join as statistical inflection point; advisory `context.rot_risk`, not a hard gate; lands last |

---

## §1 — Per-provider tokenizer calibration (replaces uniform 1.2×)

**Problem.** `estimateBudgetTokens = ceil(tiktoken(raw) × 1.2)` uses
cl100k_base/o200k_base for every provider, but Anthropic and MiniMax don't
tokenize with tiktoken. The 1.2× factor compensates for an unmeasured,
content-dependent mismatch — code vs. prose drift differently per vocabulary —
so "safe" is an assumption, not a measurement.

**Design.**

1. **Calibration event.** Every provider response already returns actual usage
   (`input_tokens` / `usage.prompt_tokens`). Log a `token.calibration` EventLog
   entry per model-facing request, keyed by the same `invocationId` (C2 #21)
   used for `context.snapshot.created`, carrying:
   `{ provider, model, estimated_raw, estimated_padded, actual }`.
   Pure observation — no behavior change.
2. **Burn-in window.** 200 requests/provider or 7 days, whichever first.
   During burn-in, `SAFETY_FACTOR = 1.2` remains the default.
3. **Factor derivation.** After burn-in,
   `providerCalibration[provider] = p95(actual / estimated_raw)`, clamped to
   `[0.8, 2.0]` as a guardrail against pathological burn-in samples. Replace
   the single `SAFETY_FACTOR` constant with
   `providerCalibration: Record<Provider, number>` defaulted to 1.2.
4. **Persistence.** Store alongside `MODEL_OVERRIDES` in
   `~/.alix/calibration.json` (established config-home convention — see
   `src/security/evidence/skill-install-history.ts:42`, which uses
   `join(homedir(), ".alix", "security")`). Follow the same pattern as that
   file: read `~/.alix/calibration.json` by default, but accept a store-dir
   override so tests get HOME-isolation. Survives restarts.
5. **Rolling recompute.** Recalculate on a rolling window (not one-shot), since
   providers change tokenizers/pricing without notice. Each entry records its
   sample size + `lastRecalibrated` timestamp.

**Non-goal:** exact per-provider tokenizer implementations (e.g. Anthropic's
actual BPE). Calibrated tiktoken is a cheaper, self-correcting proxy and avoids
a hard dependency on providers publishing tokenizer specs.

---

## §2 — Tool schema scoping (T1a/T1b, dynamic mandatory core)

**Problem.** All registered tool schemas are unshifted into Tier-1 mandatory,
all-or-nothing, with no per-task relevance filter. The risk grows monotonically
as MCP servers accumulate — nothing shrinks the mandatory core back down.

**Design.**

1. **Split Tier 1:**
   - **T1a — core tools:** always-mandatory, small, task-invariant (file ops,
     shell, patch/apply). Stays as-is.
   - **T1b — extended/MCP tools:** scoped per task via a relevance filter
     *before* classification runs, not after overflow.
2. **Relevance filter** (cheap, deterministic, no LLM call). Signal sources
   available at filter time:
   - Tool name-prefix (`alix_*`) and MCP `server::tool` namespace,
   - Description keyword overlap with the task prompt,
   - `classifyTask(task)` result (bugfix/feature/refactor/docs/research/unknown).
   Default policy if no match signal exists: admit tools used in the last N
   turns of the current run (recency); if the task is fresh with no signal,
   fall back to full admission — logged as `tooling.scope.fallback_full` so a
   cheap-heuristic miss is visible.
3. **Distinct overflow causes.** After scoping, if T1a+T1b+T2 still overflows:
   - `context.irreducible.tooling` — tool schema bloat (fix = re-scope tools),
   - `context.irreducible.content` — genuine prompt/task bloat (fix = shrink
     task description).
   Separating these matters because the fix differs. Additive to the existing
   throw path — C2 #18's graceful `RunResult` remains the backstop.

### Shed-tool contract (exclusion + runtime re-scope)

When scoping removes a tool from T1b, the tool is **excluded from the request**
(not listed as known-but-disabled), but the model may still attempt to call it.
That attempt reuses the **existing scope-expansion retry path** — the
`pendingScopeExpansion: Set<string>` machinery that already detects a blocked
capability request, expands scope, and retries the call. A shed-tool call and a
permission-denied call are the same shape of event: model wants X, X isn't
currently admitted, decide whether to admit and retry.

**Flow:** shed-tool call → blocked-and-retriable state → re-admit that specific
tool → retry the call once. Logged as `tooling.scope.reintroduced` — distinct
from `tooling.scope.fallback_full` (that is "couldn't decide, admitted
everything"; this is "decided wrong, correcting"). The distinct event lets the
§3 join reveal whether the relevance filter systematically under-scopes a tool
class, which is what you'd actually tune over time.

**Guardrails:**
- **Retry once, not per-call.** If the model calls the same shed tool twice
  after re-scope failed to help, that's a normal tool-use failure, not a
  scoping failure — don't loop.
- **Re-scope is additive-only within a turn.** Only the specific shed tool the
  model tried to call is re-admitted — not a full re-run of the relevance
  filter. Keeps the retry cheap and the budget delta predictable (one tool
  schema's worth, not a re-classification), preserving the "no oversized
  request" invariant.

---

## §3 — Drop → failure-signal feedback loop (`contextPressure`)

**Problem.** T4–T6 skip-and-continue drops are logged but nothing downstream
asks whether a given drop *mattered*. `findUnsubstantiatedClaims()` and the
stuck-loop breaker (`stuckToolAttempts`, `toolCountAtLastNudge`) detect
behavioral failure symptoms independently. The two signal families have never
been joined, so the hypothesis "does truncation cause context rot" is untestable.

**Design.**

1. **`contextPressure` on `RunResult`.** Tag every terminal `RunResult` with a
   `contextPressure` field, sourced directly from assembly output — no new
   computation:
   ```
   contextPressure: {
     aggregate: { tier4Dropped, tier5Dropped, tier6Dropped, minRemainingTokens },
     peak: { iteration, tier4Dropped, tier5Dropped, tier6Dropped, remainingTokens },
   }
   ```
   - **Aggregate** = sum of tier4/5/6 drops across all iterations, min
     `remainingTokens` seen — the coarse "did this run experience pressure at
     all" signal for `tier5Dropped > 0` grouping.
   - **Peak** = the single iteration with the highest drop count (or lowest
     `remainingTokens` — pick one consistently; they usually agree), stored
     with its `iteration` index. Chosen over "final iteration" because for a
     `stuck_repeating_tools` run the final iteration is often *cleaner* (the
     model loops on narrow tool calls rather than accumulating context) — the
     least likely to show where pressure mattered. The peak is the most
     plausibly causally proximate iteration, wherever it fell in the run.
2. **Join against failure classifications.** Extend `RunResult.reason`'s
   record with `contextPressure` and persist both in the EventLog alongside
   each other. Analysis is offline/aggregate, not per-run inline.
3. **Free proximity metric.** `iterationsSincePeak = totalIterations − peak.iteration`
   — derived, no extra field. Answers "did pressure right before failure matter
   more than pressure early and recovered-from".
4. **The experiment.** The join becomes queryable:
   `reason IN (completed_unverified, stuck_repeating_tools) GROUP BY contextPressure.tier5Dropped > 0`.
   - If failure rate is statistically indistinguishable between pressured and
     unpressured runs → truncation tiering is fine as-is; effort goes to §2.
   - If distinguishable → a target threshold exists to design admission policy
     around (see §6).

**No behavior change** — observation infrastructure, consistent with the
Phase C0 principle of instrumenting before building.

---

## §4 — Within-tier ordering (recency fix + explicit config)

**Two-part change, deliberately decoupled in rollout.** Part A is a correctness
fix shipped first; Part B is mechanical config plumbing with no urgency. Their
decoupled ship dates are intentional, not an oversight.

### Part A — recency fix (urgent, self-contained)

**Problem (correctness bug).** `classifyCandidateContext` iterates messages in
chronological order (index 0 = oldest, `task-loop.ts:1404`). `assembleContext`
preserves that bucket order when admitting T4–T6 (`context-assembly.ts:135`).
So under budget pressure the **oldest** messages and tool results are admitted
first and the **newest (most relevant) are dropped** — in tiers literally named
`recent_conversation` and `recent_tool_results`. The tier name asserts intent;
the admission order contradicts it. This is a correctness bug wearing a
data-dependent disguise — no §3 evidence needed to know which end of a "recent"
tier should survive pressure.

**Fix.** Reverse T4/T5 admission to newest-first (T6, `older_context`, keeps
chronological as its recency fallback). Wire-safe because `reconstructRequest`
re-sorts admitted items by source index (`task-loop.ts:1445`), so admission
order never leaks into conversation chronology on the wire — only priority
changes. No new config needed; the new order becomes the fixed default.

**Rollout rationale.** The fix ships **before** §3 instrumentation so the
pressure→failure baseline is measured against admission logic that matches the
tier's intent, not a systematically wrong prior. Measuring §3 against the
inverted-recency baseline would bake a known-bad ordering into whatever signal
you extract.

### Part B — `tierOrderingStrategy` config (mechanical, later)

Explicit, per-tier-typed ordering config so non-recency strategies become
possible without code changes:

```
tierOrderingStrategy: Record<Tier, 'recency' | 'recency-dedup' | 'relevance'>
```

- **T4 (recent conversation):** `'recency'` — strict newest-first (Part A's fix).
- **T5 (recent tool results):** `'recency-dedup'` — recency within the same
  task/turn, but de-prioritize results already summarized/superseded by a later
  result on the same resource (e.g. an old `file.read` of a file re-read later)
  — detected via matching item metadata (tool name + args hash) at
  classification time.
- **T6 (older context):** `'recency'` fallback, but the tier most worth
  revisiting once §3 data exists — if T6 drops correlate with failures,
  T6 needs `'relevance'` (keyword overlap with current task) rather than pure
  recency.

Defaults preserve the Part-A behavior. This lands in step 3 of rollout, purely
as documentation + explicit config — an algorithm change is gated on §3 evidence.

---

## §5 — Decouple `reservedOutputTokens` into two knobs

**Problem.** `reservedOutputTokens = min(policyReservation, modelOutputLimit,
window)` is used both as (a) the budget-planning reservation that determines
`availableInputTokens`, and (b) the literal `maxOutputTokens` sent to the
provider. Coupling them means you can't tune cost/latency without touching
overflow-safety math, or vice versa.

**Design.**

1. **Split the fields:**
   - `budgetReservation` — used only in
     `availableInputTokens = window − budgetReservation`. Keeps the existing
     `clamp(floor(window × 0.2), 4096, 32768)` formula. This is the
     safety-margin knob.
   - `requestedMaxOutputTokens` — sent to the provider as `maxOutputTokens`,
     independently configurable. Defaults to `budgetReservation` → current
     behavior preserved exactly.
2. **Invariant.** `requestedMaxOutputTokens ≤ budgetReservation` asserted at
   construction (in `createContextBudget`), rather than the current implicit
   1:1 coupling. Because `requestedMax ≤ budgetReservation`, tuning output
   length can never itself cause overflow.
3. **Config surface.** One new key: `context.budget.maxOutputTokens` (nullable,
   clamped ≤ `budgetReservation` at construction). No per-task-type default
   table this cycle — those would be guesses dressed as a table, exactly the
   premature commitment §6's design rejects. Once the single knob exists,
   usage data on it naturally becomes the input to a future per-task-type
   table if one ever turns out to be justified.

**Net effect:** tightening output length for cost/latency no longer silently
frees input budget as a side effect (or vice versa). The two changes become
independent config surfaces.

---

## §6 — Context rot threshold (deferred, learned not guessed)

**The tying piece** for §1–§5, answering the standing Phase C0 question:
**treat context rot as an empirically-derived, per-signal threshold on
`contextPressure` (§3) and calibration drift (§1) — not a fixed token-count
cutoff.**

**Why not a token-count threshold.** A flat "budget must stay under 80% of
window" is exactly the premature budgeting infrastructure Phase C0 was designed
to avoid. Two runs at identical token counts can have very different outcomes
depending on *what* got dropped (T4 recency drop vs. T6 stale-context drop) and
whether the estimate itself was accurate (§1 calibration).

**Design — degradation is declared, not assumed:**

- Define the threshold as a **statistically observed inflection point** in the
  §3 join: the `contextPressure` value (e.g. `tier5Dropped` count, or
  `remainingTokens` as % of `availableInputTokens`) at which `RunResult.reason
  IN (completed_unverified, stuck_repeating_tools)` rate rises significantly
  above the pressure-free baseline. Requires §3's burn-in before a number can
  be committed — do not hardcode a guess now.
- Once observed, record it as `contextRotThreshold` in
  `~/.alix/calibration.json` (same file as §1 — both are learned constants,
  not fixed) with sample size + confidence interval + `lastRecalibrated`,
  making the number auditable and re-derivable rather than a magic constant
  that silently goes stale as tool composition (§2) and task mix change.
- Once a threshold exists, `assembleContext` emits a `context.rot_risk`
  EventLog warning (**advisory, not a hard failure**) when a run's realized
  `contextPressure` crosses the learned threshold *before* the run completes —
  giving the stuck-loop/claim-verification layers a prior to weight their own
  detection against.

**Explicitly rejected alternatives:**
- **Fixed percentage of window** — doesn't account for what's dropped, only how
  much.
- **Zero-drop-tolerance** — over-conservative; large-window models routinely
  admit everything with huge headroom, so "any drop = degraded" miscalibrates
  for exactly the runs least at risk.

**Sequencing:** §3's join must exist and accumulate data before §6's threshold
can be anything other than a placeholder — intentionally the last item to land.

---

## Rollout order

| Step | Work | Behavior change | Rationale |
|---|---|---|---|
| 1 | **§4 Part A** recency fix (flip T4/T5 admission order) | Yes (correctness) | Correct the baseline before measuring anything against it |
| 2 | **§1 + §3** calibration logging + `contextPressure` tagging | None (pure instrumentation) | Both just add EventLog/RunResult fields to existing pipeline output |
| 3 | **§5 + §4 Part B** knob split + `tierOrderingStrategy` config | None (defaults preserve behavior) | Mechanical refactor, unblocks independent tuning |
| 4 | **§2** tool scoping (T1a/T1b + shed-tool contract) | Yes (admission) | Highest leverage vs. irreducible-overflow; heuristic validated against real task metadata first |
| 5 | **§6** threshold | Advisory only | Gated on §3 burn-in data |

## Non-goals

- Exact per-provider tokenizer implementations (§1) — calibrated tiktoken proxy instead.
- Per-task-type output defaults (§5) — single knob first, table only if data justifies it.
- Hard `context.rot_risk` gate (§6) — advisory only, by design.
- Replacing C2 #18's graceful `RunResult` backstop (§2) — scoping reduces how
  often it fires, never replaces it.
- `relevance` ordering for T6 (§4) — gated on §3 evidence that T6 drops matter.

## Testing

- **§4 Part A:** unit test — under budget pressure, newest T4/T5 items admitted
  first; wire order preserved by `reconstructRequest` (assert conversation
  chronology unchanged).
- **§1:** unit test of factor derivation + clamp; integration smoke — a
  `token.calibration` event lands per request with correct fields.
- **§3:** unit test — `contextPressure` aggregation + peak selection across a
  multi-iteration run; `iterationsSincePeak` derivation.
- **§5:** unit test — invariant `requestedMax ≤ budgetReservation` asserted;
  default preserves `reservedOutputTokens` behavior; config override clamps.
- **§2:** unit test — relevance filter scopes T1b by task; shed-tool call
  re-admits + retries once; `fallback_full` on no-signal fresh task;
  additive-only re-scope.
