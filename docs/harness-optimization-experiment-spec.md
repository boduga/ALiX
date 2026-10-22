# Harness optimization experiment spec (deliverable 10, PRE-R022–R025)

**Status:** SPECIFICATION ONLY. **No experiment has been run and none is authorized.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §13.1 (PRE-R022–R025), §13.3.
**Depends on:** `harness2-source-review.md` (pinned upstream, contract map).
**Publication / simplification:** HOLD (Q13).

This spec defines what a *qualified* experiment would look like so a future run is
constrained before it begins. It contains **no results** and authorizes **no
execution**. Every threshold is explicitly absent: PRD §13 forbids inventing them,
and §12.3 forbids inventing performance thresholds generally.

---

## 1. Candidate manifest — probe evidence contract (PRE-R022)

Every candidate must be described by this record **before** it is executed, and the
record is read-only once the probe starts. A candidate without a complete manifest
is not runnable.

| Field | Content | Failure if absent |
|---|---|---|
| `baseVersion` | commit SHA of the harness being modified | Result unattributable |
| `baseHash` | content hash of the assembled prompt/config actually used | Cannot prove the arm differs only as intended |
| `scopedDiff` | exact change (prompt section removed/added, config key, tool set) | Scope creep indistinguishable from effect |
| `domain` | task domain (upstream uses e.g. accounting, legal, office/web/code) | Domain lessons leak across domains |
| `model` + `executor` | provider, model id, executor (in-process vs child) | Not comparable across arms |
| `tools` | the offered tool surface (exact names) | Tool-surface change masquerades as harness effect |
| `permissions` | policy revision, session mode, owned scopes | A "cheaper" arm may simply be less constrained |
| `fixture` | task id + seed + environment | Not reproducible |
| `scorer` | evaluator identity and version | Verdict not independent |
| `budgets` | token, wall-clock, recursion budget | Unbounded runs cannot be compared |
| `provenance` | origin of the candidate (hand-written, model-proposed, upstream-derived) | Cannot audit where a change came from |
| `observedOutcome` | filled **after** execution only | — |
| `failureState` | one of the taxonomy classes (§2) | Unclassified failure invalidates the arm |

---

## 2. Paired benchmark specification (PRE-R023)

### 2.1 Comparison shape

- **Paired**: baseline arm and candidate arm on the **same** task set, model,
  executor, environment, scorer and seed.
- **Randomized ordering** between arms to limit drift, with ordering recorded.
- **Repetitions**: n≥3 per arm minimum; more where variance is observed. (Every
  existing ALiX baseline is n=1 — see `harness-readiness-report.md` U-2.)
- **Full cost accounting** per `harness-benchmark-spec.md` §2.1: total measured cost
  ÷ independently verified successes, **with failed tasks in the numerator**.
- **Uncertainty reported with every point estimate.** No single-run claim.
- **Missing measures are `null`** with coverage counts, never zero.

### 2.2 Failure taxonomy (PRE-R023 + §3 rule 4)

Every non-success is classified as exactly one of:

1. **Task failure** — the objective genuinely did not land.
2. **Harness failure** — the loop/agent infrastructure failed (e.g. delegate
   transport, malformed patch pipeline).
3. **Provider failure** — rate limit, transport, refusal.
4. **Planner-contract failure** — a plan that violates the contract (Gate 7's
   glob-scoped infra-worker cancellation is the recorded example).

A planner-contract failure is **never** scored as a task failure. Misclassification
here is the single easiest way to produce a false improvement.

### 2.3 Scoring independence

The scorer is the **existing** evaluator honesty contract (`landed` + `honest`).
The harness under test must never score itself. Where a candidate proposes a
scoring change, that change is out of scope for the experiment comparing it.

---

## 3. Isolation qualification before any model-backed probe (PRE-R024)

**This is a hard gate. No model-backed probe runs until every row below is
qualified.**

| Control | Requirement | Current ALiX state |
|---|---|---|
| Sandbox / filesystem boundary | Workspace containment enforced; no writes outside the isolated root | Exists (`WorkspacePathResolver`, workspace containment contract) |
| **Restricted egress** | Domain allowlist, DNS validation, private/link-local rejection — **including shell clients** | Exists (root contract: network policy applies to shell clients) |
| No hidden rubrics | Benchmark answers/graders unreachable from the probe environment | **Must be verified per benchmark** — upstream warns rubrics may be online |
| Secret controls | Credentials from the store only; never in env files or argv | Exists (store-only key resolution) |
| Prompt-injection defenses | Fetched/retrieved content treated as data, never instructions | Exists (root contract) |
| Side-effect policy | Approval-gated execution; no new write path | Exists (`ExecutionAuthorization` → `PolicyGate`) |
| Replay | Runs reproducible from recorded evidence | Partial — seven drivers committed and runnable; four cost files have no committed producer (U-1) |
| Negative tests | S0 negatives run **per arm**, a bypass is never a success | Exists; must be wired per arm |

**Explicitly rejected from upstream:** unrestricted executor network access and
disabled Codex sandboxing. PRD §13.3 pre-authorizes this rejection; the source
review records why (§4.1 there).

**Blocker:** "No hidden rubrics" is unqualified for every upstream benchmark
(JobBench/LAB/WorkBuddy are public, and upstream itself warns graders may be
fetched). Until that is closed, a model-backed probe would measure contamination
as much as capability.

---

## 4. Recursion budgets and ordering (PRE-R025)

| Concern | Rule |
|---|---|
| Parallel recursion | `--k K --mode parallel` probes K general + K domain candidates. Budget must be **fixed before** the run and recorded per candidate |
| Sequential recursion | `--k K --mode sequential` refines through K steps. Step count is part of the manifest |
| **Deterministic task ordering** | Selection and ordering recorded with a seed; the same seed yields the same subset |
| **Incomplete-run accounting** | A candidate that fails mid-recursion is counted with its failure state, never dropped. Dropping incomplete runs inflates the surviving arm |
| Domain-lesson provenance | A domain-specific lesson must record the domain it came from; it may not silently globalize |
| **Holdout validation** | A portion of tasks is held out from proposal and used only for scoring, or the result is explicitly marked optimistic |
| Rollback criteria | Every adopted candidate must be revertible in one commit; no candidate implies data migration (per `harness-cutover-plan.md` §3) |

### 4.1 Cost ceiling

Not defined. PRD §13 forbids inventing one; the operator sets it. For scale, a
first admissible ALiX ablation is estimated at ~60 scored runs
(`harness-ablation-report.md` §5); a Harness²-style recursion multiplies that by
`(2K+1)` per task-level step.

---

## 5. Stop rules

A probe halts immediately on any of:

1. **Egress violation** — a shell client or fetch reaches a non-allowlisted host.
2. **Rubric contamination** — benchmark answers or graders become reachable.
3. **Authorization bypass** — any arm completes an action without its required
   approval, or an S0 negative fails.
4. **Unbounded recursion** — budget exceeded.
5. **Unreproducible arm** — the manifest cannot reconstruct the run.
6. **Secret exposure** — any credential appears in evidence or logs.

Halt means: stop, record the failure state, do not report a comparison.

---

## 6. Verdict

**PRE-R022–R025: specified, NOT executed.** Gate for model-backed probing **not
cleared** (hidden-rubric control unqualified; reproducibility partial).

The value is the constraint set: manifest-before-execution, paired arms with n≥3,
four-way failure taxonomy, per-arm S0 negatives, and a stop list that
pre-commits to not reporting a comparison when isolation fails.
