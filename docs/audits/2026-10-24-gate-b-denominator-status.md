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
