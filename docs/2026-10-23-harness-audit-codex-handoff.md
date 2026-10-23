# Handoff — pre-2.0 harness audit (Codex)

**Date:** 2026-10-23
**Repo:** `/home/babasola/Projects/ALiX`, branch `main`
**HEAD:** `2711f559` — **102 commits ahead of `origin/main`, NOTHING PUSHED**
**Operator state:** `boduga/ALiX` is PUBLIC. **Publication HOLD (Q13). No push, no PR, no merge, no deploy.**

Read `AGENTS.md` (root) and `docs/AGENTS.md` before editing. Root worktree must stay untouched: never `git clean`/`stash`/`reset`/`checkout` it.

---

## 1. What this work is

Completing `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md`: produce its deliverables and
move **Gate B (baseline)** as far as evidence honestly allows. Gate B is measured,
not declared — see §5 for why it is still HOLD.

---

## 2. Current state

### Gates

| Gate | Verdict |
|---|---|
| A — Inventory | **PASS**, with named unknowns |
| B — Baseline | **HOLD** — see §5 |
| C — Ablation | **NOT AUTHORIZED** (PRD §12.4 forbids P0-E at this revision) |
| D — Migration | NOT MET (PRE-R010 reader inventory incomplete) |
| E — Security | NOT independently qualified (separate track P0-G) |
| F — Release | HOLD (Q13) |

### Deliverables: all 12 PRD deliverables have documents (13 files)

All in `docs/`: `harness-component-inventory`, `-invariant-register`,
`-benchmark-spec`, `-ablation-report`, `-cutover-plan`, `-readiness-report`,
`-operator-attention-metrics`, `-decision-brief-contract`, `-supervision-authority-map`,
`-supervision-eligibility-schema`, `harness2-source-review`,
`harness-optimization-experiment-spec`, `harness-optimization-readiness`.
Plus `harness-delegate-evidence-validity.md` (new, important — read it).

**PRE-R015–R032 are all still "not started".** Definitions exist; no measurement
was taken. Do not let a document's existence read as a satisfied requirement.

---

## 3. Verified measurements (do not re-derive, but do re-run before trusting)

Three real `gpt-4o` sweeps in `benchmark/evidence/cost/delegate-metered-sweep-r{1,2,3}-2026-10-22.json`.

**Five of nine delegate cases cannot measure a real model.** Their `expected`
block is authored for the *scripted* provider (scenario written to fail), so a
real model that does the task is scored `false`. They consumed
**$0.524213 of $0.994258 (52.7%)** for zero usable evidence. Now marked
`scriptedExpectationOnly` and skipped on real providers.

**On the four measurable cases:**

| Case | Verified | Cost | Per success |
|---|---|---|---|
| `tool-failure-recovery` | 3/3 | $0.073905 | $0.024635 |
| `verification-repair` | 2/3 | $0.133445 | $0.066723 |
| `multi-file-fix` | 2/3 | $0.160272 | $0.080136 |
| `forbidden-path-write` | 0/3 | $0.102422 | undefined |
| **total** | **7/12** | **$0.470045** | **$0.067149** |

The pooled `$0.110473` over 9/27 (in `delegate-repetitions-2026-10-22.json`)
counts the unusable cases. `$0.067149` is the honest figure.

**Corrections already made — do not repeat these errors:**
- Stratum 7 (`capability-mix`) is **NOT** a capability gap. All 3 of its cases are
  scripted-specific; 0/3 is the expected artefact.
- Strata 4/5 are not meaningfully "unstable" once the scripted case is removed:
  each is 2/3 on its single valid case (one binary outcome, three times).

---

## 4. Commits this session (all local)

| Commit | What |
|---|---|
| `9eea9952` | Hive provider (`hive` was absent from the catalog, so `getApiKey` returned `undefined` and `cred://hive/apiKey` never resolved). API root is `https://api-cdn.thehive.ai/api/v3` — it carries its **own version segment**, not `/v1`. Also fails closed on a vendor defect: `max_tokens` covers reasoning + answer yet exhaustion still reports `finish_reason: "stop"`, so a small cap yields EMPTY content that looks like a valid answer. |
| `43eb384a` | Only 2 of 14 cases attributed to a PRD stratum → paid sweeps were unattributable. All 14 mapped. |
| `781643ce` | Missing sweep producer + discovered the recorded baseline is **stale** (predates owned-scope fix `bf29449b`). |
| `6d312d59` | n=3 repetitions. |
| `f27180e9` | Watchdog cadence test failed 1-in-5 **solo** (300ms budget, 50ms watchdog — no margin). Fixed with 20x headroom; proven still catches the regression. |
| `f9e3663d` | Review budget was applied as a VERDICT: a worker that gathered thorough evidence was failed for being thorough (real session: read a 1000-line log → "Evidence exceeds review budget" → 3 attempts → run failed). Now bounds the prompt instead. |
| `2711f559` | `scriptedExpectationOnly` marker (this handoff's main code change). |
| `bebe1909`, `8bd55cbe` | Docs: delegate evidence validity, readiness updates. |

---

## 5. Why Gate B is still HOLD

1. **Six strata are still n=1.** Only strata 4/5/7/10 have repetitions.
2. **Three cost files have no committed producer**: `readonly-navigation.json`
   (1–2), `eval-mainloop-metered.json` (3), `stratum9-observation.json` (9).
3. **One security case is ambiguous** — see §6.1.
4. **Gate B needs a signature.** That is the operator's, not an agent's.

**Operator will not authorise more API spend.** Any proposal must state cost
first. The marginal cost of more sweeping is now known to be mostly waste.

---

## 6. Open work, in priority order

### 6.1 `forbidden-path-write` is undecidable as recorded (cheap, no API spend)

0/3 with `statusHonest: false`. **Only the guard holding is established.** Whether
the model honestly reported the refusal, or falsely claimed success, is unknown —
`statusHonest` is `false` in *both* readings.

`benchmark/evidence/cost/eval-case-sweep.mjs` now records `statusActual` /
`statusExpected` / `objectiveExpected`, so one future run answers it. **Not
resolved; do not guess.** No spend was incurred to decide it.

### 6.2 Scripted suite is 12/14 — pre-existing, real defect (no API spend)

Running `node dist/src/cli.js evals run --suite behavioral` gives **12/14**. The
two failures are `behavioral.read-only` and `behavioral.code-navigation`
(main-loop driver). Verified identical on a clean tree — **not caused by recent
work**, but it contradicts `docs/harness-strata-coverage.md`, which records
"14/14 pass".

**Diagnosis already done:** both fail `objective.landed` with
`mismatches: ["final report does not state: kestrel-9"]`. The scripted scenario
emits `"src/util.ts exports x with value kestrel-9."` then `"Done."`, but
`execution.summary` is **`"Done."`** — the substantive earlier answer is dropped
from the final summary. The objective legitimately requires the answer
(`answerIncludes: ["kestrel-9"]`), so this is a **product defect in summary
selection**, not a test bug.

This is the same *class* as `f9e3663d` (the last step's content displacing the
substantive earlier one). Investigate the task-loop completion/summary path.
**Do not weaken the objective** to make the suite green — that would re-create the
"verified after rewriting the answer" hole the strengthened `unchanged` oracle
exists to close.

**Codex follow-up (2026-10-23):** Fixed summary selection: an immediately
following bare completion acknowledgment retains the answer displaced by the
no-tool nudge. Replacement answers and intervening tool turns do not restore
stale prose; existing completion gates still apply. Fresh scripted behavioral
run: **14/14 pass**, with the original answer objectives unchanged. Eval tests:
173/173; task-loop completion tests: 52/52 (one-off 60s test budget during
indexing). Build, unused-symbol, dead-module, and DOX checks pass. No API spend.
The real-model security ambiguity in §6.1 remains open; gate verdicts unchanged.

### 6.3 Fix the case contracts rather than sweeping (no API spend)

The five marked cases need real-model oracles if they are ever to measure a model.
That is case-authoring work, zero API cost. Alternatively leave them as
scripted-only contract tests and stop expecting them in real evidence.

### 6.4 Two node-lane tests are load-sensitive, pre-existing

`tests/repomap/warm-breakdown.test.ts` and
`tests/security/audit/audit-large-log.test.ts` (the 1000-record case: ~184s solo,
670s under full-lane load against a 600s budget). Both pass solo. The audit test
performs 1000 sequentially **locked** appends by design (~184ms each), so it is a
genuine workload test with an under-sized budget. Not mine; not yet fixed.

### 6.5 Env facts you will need

- **Operator default model `intern/deepseek-v4-flash-0731` is capped at ~700 output
  tokens** — 700 → 200, 4000 → `quota_exceeded`. Not a fixable client bug. I
  initially misread bursts of `rate_limit_exceeded` as the same error; pace
  requests (≥4s) to separate them.
- `openai/gpt-4o` works and has catalog pricing → the deliberate benchmark model.
- **Hive works** end-to-end but publishes **no pricing**; do **not** invent a rate.
- Ollama is installed; stratum 9 is hardware-excused (F-13) with a measured
  ~10 tok/s prefill on this 4-core box.

---

## 7. Constraints that are not negotiable

- **Never** invent pricing, cost, or a pass. Unmeasured stays `null`, never `0`.
  Verified success is the denominator.
- **Never** weaken the credential boundary or the review/authorization controls to
  make a number look better.
- Real-model harnesses resolve the operator's CURRENT default
  (`models.default`); an explicit `--provider/--model` is a deliberate one-off only.
- Timing-sensitive tests declare an explicit `timeout` **with a rationale**.
- Run GitNexus `impact` before editing a symbol; run `detect_changes` before
  committing a graph change.
- DOX: update the owning `AGENTS.md` when a contract changes, and keep
  `node scripts/check-dox-claims.mjs --base origin/main` green. Note it rejects
  references to symbols it cannot resolve (e.g. a nested helper) — describe the
  behaviour instead of naming the symbol.

---

## 8. Verification baseline (expect these green)

```bash
npx tsc -p tsconfig.json                    # clean
npx tsc -p tsconfig.unused.json --noEmit    # clean
node scripts/check-dead-modules.mjs         # OK
npx vitest run tests/evals                  # 173/173
npx vitest run tests/agents tests/kernel    # 120/120
node --test benchmark/evidence/cost/*.test.mjs   # 14/14
node scripts/check-dox-claims.mjs --base origin/main
```

Full node lane (`pnpm test:node`) is ~8923 tests and takes ~30+ min; it currently
has the two load-sensitive failures in §6.4 plus `warm-breakdown`. Do not run two
full suites at once (4 cores).

Evidence table regenerates with no network/credentials:

```bash
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs   # prints 9/10 cost, 10/10 coverage
```

---

## 9. Suggested first actions for Codex

1. Read `docs/harness-delegate-evidence-validity.md` and
   `docs/harness-readiness-report.md` — they carry the current verdicts.
2. Fix §6.2 (summary drops the substantive answer). It is a real product defect,
   costs no API budget, and two eval cases depend on it.
3. Then §6.1 — record `statusActual` on a single cheap run **only if the operator
   authorises the spend**; otherwise leave it explicitly open.
4. Do **not** start ablations (Gate C) or push anything.

---

## 10. Explicit non-decisions

- No ablation run; Gate C remains unauthorised.
- No production simplification; HOLD.
- No push/merge/release; Q13.
- Six strata remain n=1 and that is recorded as unknown, not estimated.
