# Gate B collection — run manifest and spend gate

**Status: READY TO RUN. NOT RUN. NO SPEND AUTHORIZED BY THIS DOCUMENT.**
**Date:** 2026-10-23
**Proposal:** [collection proposal](2026-10-23-gate-b-collection-proposal.md) (approved, ceiling `$4.50`)
**Blocker for a defensible result:** [scorer engagement](2026-10-23-gate-b-scorer-engagement.md) — a run without one is author-only.

## 1. Why this document exists and why nothing has run

Everything mechanical is ready: §3 pins computed before invocation, §4 capture
before cwd cleanup, a validated rate snapshot, a provider that answers. What is
*not* ready is the ability to make a claim from the result, because GB-12 is open.

So this is a manifest, not a collection. Executing it now would produce evidence
that is author-scored by construction and would have to be labeled as such.

## 2. Preconditions — every one must be green

| # | Precondition | Command / check | State |
|---|---|---|---|
| 1 | §4 capture landed and tested | `pnpm test:evals` | **green** (24 files) |
| 2 | §3 pins computed before the first call | pin block in sweep output | **green** |
| 3 | Rate snapshot recorded with provenance | `benchmark/evidence/cost/rate-snapshot.json` | **green** (operator gpt-4o proxy) |
| 4 | `models.default` answers | operator config | **green** (`hive`) |
| 5 | Frozen-input pin admissible | pin output `admissible: true` | **green** |
| 6 | Independent scorer engaged | — | **OPEN** |
| 7 | Pins reviewed by a second party | — | **OPEN** |

Rows 6–7 are third-party obligations. They cannot be satisfied by this agent, and
rows 1–5 being green does not substitute for them.

## 3. Exact invocation

```sh
node benchmark/evidence/cost/eval-case-sweep.mjs \
  --case behavioral.read-only \
  --rate-snapshot benchmark/evidence/cost/rate-snapshot.json \
  --output benchmark/evidence/cost/<stratum>-<date>.json
```

One case per invocation initially. `main()` records the §3 pins, exits 2 without
invoking a provider if any pin is inadmissible, and prices rows at the pinned rate
(`rateSource: "pinned-rate"`).

## 4. Ordered plan and stop rules

From the proposal §2, at the approved gpt-4o-equivalent rate:

| Order | Item | Runs | Reason for the order |
|---|---|---|---|
| 1 | One `hive` delegate probe | 1 | Settles the `runId`-on-child-usage question before paying for four |
| 2 | `forbidden-path-write` ×5 | 5 | Security case; if it fails, stop before spending on quality cases |
| 3 | Strata 1–5 cases ×5 | 25 | Volume |
| 4 | `tool-failure-recovery` ×5 | 5 | Recovery sequence evidence |
| 5 | Stratum 6 four-worker | 3 | Coordination |
| 6 | Stratum 8 kill/resume | 3 | Crash integrity |
| 7 | Stratum 9 local CPU | 1 | Non-billable |

**Stop immediately and report, without substituting results, if any of:**

1. A pin is inadmissible (exit 2) — do not retry with a weaker pin.
2. An S0 negative fails, or a run executes an unauthorized action.
3. An `inadmissible` outcome recurs enough that planned n is unreachable — report
   achieved n, never pad.
4. A session event stream cannot be retained.
5. Unknown non-idempotent effect followed by an automatic retry.
6. Spend reaches `$4.50` — hard stop, partial coverage reported as partial.

## 5. Spend ledger

| Item | Notional (gpt-4o rates) | Actual |
|---|---|---|
| 4 probe calls made 2026-10-23 while wiring capture/pins | `~$0.68` | **unknown** — hive publishes no rate |
| Ceiling remaining | `~$3.82` of `$4.50` | — |

The "actual" column is unknown and stays unknown. A proxy rate supports planning
and ceiling arithmetic; it does not describe the bill. Any future cost claim must
say which of the two it is reporting.

## 6. What a completed run would still not establish

- Independently verified success (GB-06 denominator) — needs the scorer.
- Operator attention (GB-11) — needs observed human review time, not a model run.
- Invoice reconciliation — the proxy is not a bill.
- A distribution — n=5 per case supports counts, not rates with uncertainty.

## 7. The honest next step

Engage the scorer **first**, then run. Doing it in the other order produces
expensively-produced evidence whose only admissible label is "author-only", which
is where this audit started.
