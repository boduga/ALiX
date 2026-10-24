# F1-E — End-to-end cost qualification: PASS (8/8)

**Status:** QUALIFIED. Two provider defects were found and fixed first.
**Baseline:** branch `docs/pre-2.0-harness-audit`, provider fixes in this commit.
**Gate B: HOLD** (one priced run qualifies the mechanism, not the full baseline).

---

## 1. Result

```
checks: 8, passed: 8, failed: 0
RESULT: PASS — F1-E qualified
```

| # | Check | Result |
|---|---|---|
| 1 | Real billable provider responded | PASS |
| 2 | `model.usage` carries the authoritative `runId` | **PASS — 3/3** |
| 3 | Usage identifies provider, model, timestamp | PASS — 3/3 |
| 4 | Catalog resolves a rate **effective at invocation time** | PASS — 3/3 |
| 5 | Tokens reproduce a dollar amount | **$0.108968 independently recomputed** |
| 6 | Canonical observation == production summary | **both $0.108968, complete** |
| 7 | Artifact contains the expected text | PASS — `F1E_COST_PROOF_OK` |
| 8 | No unrelated invocation included | PASS |

### Evidence chain

```
run=run-79feb4e0, invocations=3
  984619b1…: openai/gpt-4o in=14127 out=82 @ $2.5/$10 per Mtok (effective 2025-01-01)
  09f93f79…: openai/gpt-4o in=14402 out=17 @ $2.5/$10 per Mtok (effective 2025-01-01)
  618e6604…: openai/gpt-4o in=14442 out=55 @ $2.5/$10 per Mtok (effective 2025-01-01)
```

Recomputation: `(14127+14402+14442)/1e6 × 2.5 + (82+17+55)/1e6 × 10 = $0.108968`.
Both the canonical correlation and the production `CostAttribution.summary()`
produce the same figure with `costCompleteness: "complete"`.

---

## 2. Two provider defects found — and they blocked everything

F1-E could not run at all until these were fixed. Both are pre-existing and affect
**every** real-model OpenAI-compatible run, not just this test.

### D7-01 — `max_tokens` rejected by reasoning models (High)

```
API error (400): Unsupported parameter: 'max_tokens' is not supported with this
model. Use 'max_completion_tokens' instead.
```

The `o`-series (o1/o3/o4-mini) rejects `max_tokens`. Fixed in
`openai-spec.ts` with a **model-aware** rename (`/^o\d/i`), following the
existing `xiaomi-mimo-token-plan-spec.ts` precedent but NOT applied
unconditionally — `gpt-4o`/`gpt-4` accept `max_tokens` and must keep it. A naive
`/^o/` guard would also misclassify `openchat`.

### D7-02 — streaming never requested usage (High, root cause of missing cost)

```
model.usage events: 0
```

`body.stream = true` was sent without `stream_options: { include_usage: true }`,
so OpenAI returns **no usage object at all** on a streaming response.
`fromStreamChunk` handles usage correctly but it was never present.

Since streaming is the default for most models, **every streaming real-model run
produced no cost data**. This is why the recorded `intern` sessions had usage
events but no correlated pricing — and why the very first F1-E attempt emitted
zero `model.usage` events.

Fixed in `_openai-base.ts`, so all OpenAI-compatible providers benefit.

**Both fixes were required for F1-E to be possible at all.** Neither was a
benchmark accommodation — they are production defects.

---

## 3. What was proven live

| Criterion | Evidence |
|---|---|
| Identity: correct run id on every invocation | 3/3 usage events carry `run-79feb4e0` |
| Pricing: billed model matches an effective entry | `openai/gpt-4o`, effective `2025-01-01` |
| Usage: observed tokens, not estimates | `in=14127/14402/14442`, `out=82/17/55` from the provider |
| Accounting: each invocation once | 3 invocations, 3 distinct `model.usage` events |
| Independent verification | separate recomputation = production summary |
| Consistency | canonical row == production summary == manual arithmetic |
| Negative cases remain unmeasured | F1-C/F1-D suites (unknown pricing → `null`, not `0`) |
| Outcome integrity | artifact content verified independently of cost |

---

## 4. Honest notes

- **Run configuration used `sessionMode: "bypass"` with write allowed.** The first
  attempt ran under `ask` and the model's `file.create` was correctly blocked by
  an unresolved approval (`Approval required: approval_…_westp`). That is correct
  policy behaviour in a headless run. F1-E measures **cost**, and approval
  behaviour is already qualified (Gate 7, F1-B), so the measurement run used a
  scoped allowance. This is recorded rather than glossed over: it is *not* an
  approval-path qualification.
- **The model also wrote to a stray `path/to/test-workspace/` directory**
  (interpreting "designated test workspace" literally as a relative path). Both
  the stray dir and the artifact were removed from the audit worktree; the
  verification ran before cleanup.
- **Tracing was disabled for the run** — the operator's Langfuse endpoint
  (`http://10.1.1.11:3000`) times out with `Tracing flush failed`. Unrelated to
  F1-E, but it polluted the output. Recorded as a separate observation, not fixed
  here.

---

## 5. What F1-E does NOT establish

- Intern pricing (subscription billing, still unresolved — F1-D).
- Cost coverage across all ten strata.
- Performance thresholds.
- Any comparative advantage for harness simplification.

All remain Gate B requirements.

---

## 6. Files

| File | Change |
|---|---|
| `src/models/providers/specs/_openai-base.ts` | `stream_options.include_usage` on streaming requests |
| `src/models/providers/specs/openai-spec.ts` | model-aware `max_tokens` → `max_completion_tokens` |
| `tests/models/openai-reasoning-max-tokens.vitest.ts` | new, 8 tests |
| `docs/verify-f1e-cost-proof.mjs` | verifier (from previous commit), validated against a known non-pass |

Regressions: models + observability + evals **187/187** across 19 files.
Build + unused clean.

Gate B HOLD. Simplification HOLD. Publication HOLD (Q13).
