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
| d | `inadmissible: false` cannot be independently established | **NOT CLOSED — structural** (see §3) |
| — | Tool-sequence evidence outside the `evidence` object | **CLOSED** — the review's scope objection is a framing issue: `guardEvidence.toolEvidence.records` was always retained, and the prompt simply narrowed the reviewer to `evidence` only |

## 3. Why (d) is structural, not a missing capture

The review's reason was precise: *"absence of a recorded infrastructure error
cannot independently exclude one."*

Attempting to close it surfaced a real limitation in the runtime:

```
src/agents/subagent-cli.ts:462    events: [],
src/agents/subagent-cli.ts:1015   events: [],
src/agents/subagent-manager.ts:435  events: parsed?.events ?? [],
src/agents/subagent-manager.ts:519  events: [],
```

**The delegate child always returns an empty `events` array.** It is not that the
capture drops them — the child never populates them. A live run confirms it:

```
behavioral.read-only      events retained: None   (main-loop: not reported)
behavioral.multi-file-fix events retained: 0      (delegate: structurally empty)
```

So no amount of capture work makes a delegate run's admissibility independently
re-derivable from this field. Closing (d) requires the child to **emit** its
diagnostics, which is a change to `subagent-cli.ts`'s result construction, not to
the eval harness. It is recorded here as an open prerequisite rather than papered
over with an empty array presented as evidence.

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

**Unchanged at `partial`.** The mechanism is now materially better — three of the
four substantive gaps are closed and independently checkable — but the denominator
still cannot be produced, because admissibility itself is not independently
re-derivable for delegate runs.

Spend context: the evidenced collection cost `$2.8483`; total proxy-priced spend is
`~$6.20` of an amended `$6.75` ceiling, leaving `~$0.55`. **A third collection is
not affordable**, and it would not close (d) even if it were, since (d) is a
runtime-emission gap rather than a capture gap.

## 6. What would actually close GB-06

1. `subagent-cli.ts` emits its own diagnostics in `SubagentResult.events` — the
   real prerequisite.
2. A collection run with that emission in place.
3. An independent pass that re-derives each outcome, including admissibility.

Steps 2–3 are spend and review; step 1 is code. Nothing in this document closes the
gate, and no figure here should be quoted as cost per verified success.
