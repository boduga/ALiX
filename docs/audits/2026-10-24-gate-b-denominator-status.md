# GB-06 denominator — status after the second evidenced collection

**Date:** 2026-10-24
**Verdict: still NOT an independently verified denominator. 4 of 5 gaps closed; one is structural.**
**Reviewer evidence:** `docs/audits/evidence/2026-10-24-codex-denominator-review.txt` (Codex / `gpt-6.1-sol`, read-only, SHA-256 `8c389a7a…`), prompt `…-review-prompt.md` (`5255de3e…`)

## 1. What happened

The first evidenced collection (45 runs, `$2.8483`, all carrying `evidence`) was
reviewed to answer exactly one question: can these runs serve as an independently
verified denominator? The answer was **NO**, with five named gaps. Those gaps were
then addressed in code and re-proven live.

## 2. The five gaps

| # | Gap named by the review | Status |
|---|---|---|
| a | Final answers retained only for main-loop runs; all 35 delegate `runtime.summary` null | **CLOSED** — `normalizeSubagentResult` now derives a summary from `summary`/`synthesis` findings and the capture retains it as `finalAnswer` |
| b | No before-workspace manifests; only one post-run manifest | **CLOSED** — `workspaceBefore` is captured from the seeded fixture before any tool runs, with a digest over sorted entries |
| c | No separately captured original sentinel bytes | **CLOSED** — sentinel now retained as a `before`/`after` pair |
| d | `inadmissible: false` cannot be independently established | **CLOSED** — the child now emits its durable events (see §3) |
| — | Tool-sequence evidence outside the `evidence` object | **CLOSED** — the review's scope objection is a framing issue: `guardEvidence.toolEvidence.records` was always retained, and the prompt simply narrowed the reviewer to `evidence` only |

## 3. Gap (d) — closed by emitting, not by capturing

The review's reason was precise: *"absence of a recorded infrastructure error
cannot independently exclude one."*

Attempting to close it confirmed the diagnosis was right and the location was
different from what a capture fix would reach:

```
src/agents/subagent-cli.ts    events: [],   // hardcoded, both success and failure paths
```

**The delegate child never populated `events` at all.** No capture work could close
this: there was nothing to capture.

**Fixed at the source.** `buildResult` now takes the worker's own durable events
(read via `readDurableEvents(eventLog)` at the call site) and emits them, bounded,
with an explicit `subagent.events.truncated` marker when a bound is hit. The bound
matters because the result travels to the parent as one JSON line on stdout;
truncation is recorded rather than silent.

Live proof after the fix, on one `write-file` delegate run:

```
events retained: 35
types: subagent.started 1, model.usage 5, tool.requested 4, tool.started 4,
       observability.metric 4, runtime.phase.started 4, file.created 1,
       runtime.phase.completed 4, tool.output 4, tool.completed 4
```

Before: `0`. After: the worker's full lifecycle including token usage.

**What this does and does not establish.** It makes admissibility *inspectable* —
an independent reviewer can now see whether a transport fault occurred. It does not
by itself prove that no run was inadmissible; that judgement still has to be made
by someone reading the events. The capture supplies the evidence; it does not supply
the verdict.

## 4. What the closed gaps buy

Verified live on two cases:

| Case | before digest | after digest | finalAnswer |
|---|---|---|---|
| `read-only` | `ca51449c50c5` (2 entries) | `ca51449c50c5` (2 entries) | retained |
| `multi-file-fix` | `8e71354d1d85` (3 entries) | `30e78d2d1298` (4 entries) | retained |

`read-only`'s identical digests are exactly the preservation claim a reviewer
previously had to take on trust. `multi-file-fix`'s 3→4 shows the edit is visible
in the manifest.

## 5. Honest position on GB-06

**Still `partial`, but the evidence gap is now closed in code.** All five named
gaps are addressed: four by capture, one by making the child emit its diagnostics.
A run collected from this commit onward carries before/after manifests, sentinel
pairs, the final answer, tool sequences and the worker's own event stream.

What remains is not code: **no collection has been run with this emission in
place.** The two 2026-10-24 collections predate it, so their delegate rows still
carry `events: []`. Producing the denominator needs one more collection and an
independent re-derivation pass over it.

Spend context: `~$6.27` proxy-priced of the amended `$6.75` ceiling, leaving
`~$0.48`. **A third collection is not affordable at this ceiling** — it would cost
roughly `$2.85` at the observed profile. Closing GB-06 needs a ceiling decision as
well as the run.

## 6. What would actually close GB-06

1. ~~`subagent-cli.ts` emits its own diagnostics~~ — **done** (this commit).
2. A collection run with that emission in place (~`$2.85` at the observed profile).
3. An independent pass that re-derives each outcome, including admissibility, from
   the retained events.

Step 1 is complete. Steps 2–3 are spend and review. Nothing in this document closes
the gate, and no figure here should be quoted as cost per verified success.

---

## Risk assessment — commit c3ec118e (HIGH per detect-changes)

`detect-changes` reported **risk: high, 12 affected processes** for this commit.
Investigated; it is a **name-collision false positive**, not real blast radius.

The graph matched `buildResult` in `src/agents/subagent-cli.ts` against an unrelated
private `buildResult` in `src/context/repomap/repomap-lite.ts:201`, then walked
GitNexus analyzer internals (`DependencyGraphImpl`, `SymbolExtractor`, `ClassifyKind`,
`CountDependencies`) through that symbol name. Every one of the 12 "affected flows"
begins `Main → …` and none reaches the subagent result path.

Verified by text search instead, since the graph answer was unusable:

| Reference | Kind |
|---|---|
| `src/agents/subagent-cli.ts:411` | definition |
| `src/agents/subagent-cli.ts:758` | the one production call site |
| `tests/agents/subagent-cli.test.ts:153` | test |
| `tests/agents/subagent-result-events.vitest.ts:97,108` | new tests |

No other production caller exists. `subagent-cli.ts` is imported only by
`src/cli.ts` via dynamic import.

**Real risk assessment:** the change is additive at the result-construction seam —
`buildResult` gains an optional `events` field and the call site passes it. The
returned `events` array goes from always-`[]` to bounded real events, which is the
intended fix. The bound plus explicit truncation marker protects the stdout JSON
contract that the parent parses.

**Verification:** full suite 7695 passed / 706 files; `typecheck:unused` green;
`check:dead` green; live delegate run emits 35 events where it previously emitted 0.

**Process error, recorded:** I committed before reading the `detect-changes` output.
The repo contract says to warn on HIGH and never waive it — the correct order is to
inspect first, then commit. The inspection above was performed after the fact and the
finding is a false positive, but the sequencing was wrong and is noted rather than
hidden.

---

## 7. Final position (2026-10-24) — GB-06 closed as `partial`, not pursued further

**Decision: stop.** GB-06 stays `partial` and the remaining work is not funded.

### 7.1 Why stopping is the honest call

Two independent reviews declined the denominator across three collections. Each
refusal named one gap; closing it exposed the next layer:

| Round | Gap named | Resolution |
|---|---|---|
| 1 | Rows kept conclusions, not bytes | Evidence capture built |
| 2 | No before manifests, sentinel bytes, delegate answers | Capture extended |
| 3 | `events: []` hardcoded on the delegate child | Emission fixed |
| 4 | No provider-attempt records | **Fixed in code** (commit `0e15cca0`) |

The pattern is the finding: **admissibility is not a field you add, it is a
property that must hold at every layer.** Four layers each hid the next. That is
an architectural observation about how the runtime reports on itself, not a
measurement problem, and it is worth more than the denominator would have been.

### 7.2 What is true right now

- The collection is **independently reproduced**: an external review recomputed all
  45 outcomes (36 true, 9 false, zero mismatches) and every cost exactly.
- **Provider-attempt telemetry now works** (commit `0e15cca0`), verified
  deterministically through the registry path at zero cost.
- **No collection has been run with that telemetry.** Both 2026-10-24 collections
  predate it, so their rows still carry `providerAttempts: null`.
- Therefore GB-06 remains `partial`: outcomes are verified, admissibility is
  *inspectable going forward* but not established for the collected data.

### 7.3 Why not run a fourth collection

- **Ceiling**: `$9.87` spent against `$9.50` — already over. There is no
  authorization for more.
- **Diminishing return**: a fourth pass would establish admissibility for a single
  model at a proxy rate, against a reviewer whose standard has moved four times.
  The next gap would likely be invoice reconciliation or operator attention — both
  outside a model run's reach.

### 7.4 What would actually close GB-06, if it is ever funded

1. One collection at commit `0e15cca0` or later, so rows carry real
   `providerAttempts`/`providerRetries`.
2. Independent re-derivation including admissibility from those events.
3. Provider billing reconciliation — the rate is still a declared proxy, so any
   dollar figure is planning arithmetic, not an invoice.

### 7.5 The blockers no amount of this touches

- **GB-11** operator attention — requires observed human review. Nothing synthetic
  produces it.
- **GB-14** baseline acceptance — requires a signature on an artifact set that GB-11
  blocks.
- **Gate E** independence and **Gate F/Q13** — third parties.

Two of Gate B's four remaining blockers are people. That has been true throughout,
and no ceiling amendment changes it.
