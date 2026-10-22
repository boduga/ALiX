# Harness² source review (deliverable 9, PRE-R020–R021)

**Status:** Reproduced (demo) / contract map complete / **no ALiX change proposed**.
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §13.1 (PRE-R020, PRE-R021), §13.2–§13.3.
**Publication / simplification:** HOLD (Q13).

Upstream Harness² is a **research input**, not ALiX evidence. Its reported
benchmark gains are hypotheses about another harness on other models; none of them
transfers to ALiX without an independent measurement, and none is claimed here.

---

## 1. Pinned upstream identity

| Field | Value |
|---|---|
| Repository | `github.com/google-research/harness2` |
| **Commit** | `1cfe254e8d25b15f37048c3730134686abe60335` |
| Commit date | 2026-10-13 21:22:49 -0500 |
| Paper | arXiv `2610.14224` — *Harness²: Recursive Agent Harnessing for an Open World* |
| License | **Apache 2.0** (top-level `LICENSE`) |
| Third-party | `third_party/{jb_runner,lab_runner,wb_runner,patches,licenses}` — **retain their own upstream licenses**; not covered by the Apache grant |
| Runtime | Python `>=3.12,<3.14`; `uv`; Node 20+ and gcloud for model-backed benchmarks |
| Benchmarks | JobBench (`jb`), LAB (`lab`), WorkBuddy-Bench (`wb`) |

Pinning the commit matters: a review against `main` drifts silently, and the PRD
requires the demo be reproducible at a stated commit.

---

## 2. PRE-R020 — deterministic demo reproduction (ATTEMPTED, SUCCEEDED)

The PRD requires reproducing the credential-free deterministic demo **or**
recording the inability. Reproduced in a disposable directory outside the repo
(`/tmp/opencode/harness2-probe`), no credentials, no ALiX code touched:

```bash
git clone --depth 1 https://github.com/google-research/harness2.git
uv venv --python 3.12 .venv && . .venv/bin/activate
uv pip install -e '.[render]'
harness2-demo --output runs/demo --k 2
```

**Observed result:**

```
Local demo: 2 tasks completed; 0 failed. runs/demo/demo.json
```

```json
{
  "domain": "accounting",
  "n_tasks": 2,
  "seed": null,
  "done": 2,
  "failed": 0,
  "execution_count": 28,
  "editor_calls": 32,
  "tasks": [
    { "task": "ledger-1", "status": "ok", "library_entries_before": { "agg": 0, "seq": 0 } },
    { "task": "ledger-2", "status": "ok", "library_entries_before": { "agg": 1, "seq": 1 } }
  ]
}
```

Artifacts produced: `runs/demo/executions/`, `runs/demo/library/k2`,
`runs/demo/sources/{ledger-1,ledger-2}`, `runs/demo/base/guardrails.md`.

**What this proves:** the framework installs from a pinned commit, runs both
recursion modes with **deterministic editors and real Python executions**, and
persists inspectable evidence — with no model credentials. That is exactly the
deterministic substrate the PRD wanted qualified.

**What this does NOT prove:** nothing about model-backed quality, gains, cost, or
ALiX suitability. The demo's editors are deterministic, so it exercises the
pipeline's mechanics, not model-driven harnessing.

**Environment caveat:** `uv` and `python3.12` were already present on this host.
The reproduction is therefore *not* evidence the host satisfies the upstream
`docs/SETUP.md` requirements for **model-backed** benchmarks (Node 20+, gcloud,
Docker for WorkBuddy, Pandoc + Poppler for LAB). Those were not exercised.

---

## 3. Eight editable components (verified in source)

The upstream README states eight editable components; the source tree supports it.

| # | Component | What it controls |
|---|---|---|
| 1 | System prompt | Base instruction context |
| 2 | Guardrails | Constraints applied around the model |
| 3 | Memory | Persisted and injected state |
| 4 | Tool guidance | How tools are described/used |
| 5 | Subagents | Delegation structure |
| 6 | Skills | Reusable capability units |
| 7 | Scripts | Executable helpers in the tool loop |
| 8 | Plugins | Middleware around the loop |

Mechanism: **task-level recursion** (Propose–Probe–Compose — propose edits, probe
their effect on the same task, compose from behavioral contrasts **without
ground-truth feedback**) and **harnessing-level recursion** (a persistent
improvement harness updated with adopted harnesses and evidence-supported lessons).
Core modules observed: `harness2/core/{proposer,recursion,ledger,library,judge,
report,schedule,selection,context,prompts}.py`; substrates
`harness2/substrate/{opencode,codex}.py`.

---

## 4. PRE-R021 — contract map to ALiX, with duplicate authority flagged

Mapping is to ALiX's **existing** owners. Any row marked *DUPLICATE AUTHORITY* is a
reason **not** to adopt, not a gap to fill.

| Harness² concept | ALiX owner | Relationship | Verdict |
|---|---|---|---|
| Harness components (prompt, tool guidance) | `buildEffectiveSystemPrompt` (`src/execution/run/task-loop/context-phase.ts:42`), single assembly owner | Same concern, different implementation | **Reuse concept only** |
| Guardrails | `PolicyGate` + `ExecutionAuthorization` (§S0-4) | ALiX has a governed authorization boundary upstream lacks | **ALiX superior — do not adopt** |
| Memory | `src/operations/utils/memory/` (recall, consolidation, decision extraction) | Same concern | Inspect, no change proposed |
| Subagents / delegation | `CoordinationScheduler` + `DefaultWorkerExecutor` / `SubagentWorkerExecutor` behind one contract | ALiX already has exactly two adapters behind one contract | **Reuse concept only** |
| Skills | `src/capabilities/skills/` (dispatch, factory, promotion) | Same concern | Inspect, no change proposed |
| Ledger / evidence | R2 runtime ledger + `EventLog` (append-is-commit) | ALiX's durability is stronger (authoritative ledger) | **ALiX superior — do not adopt** |
| Judge / independent grading | evaluator honesty contract (`landed` + `honest`), `harness-benchmark-spec.md` §2.1 | Same concern | Inspect |
| Improvement lesson library | `src/planning/evolution/`, capability evolution, learning synthesis | **Closest analogue — DUPLICATE AUTHORITY RISK** | **Do not adopt parallel store** |
| Candidate harness probes | A-series governed evolution + `ApprovalStore` | ALiX gates candidate promotion through approvals | **ALiX superior — do not adopt** |
| Egress / sandbox posture | Root contract: network policy on shell clients, workspace containment, approval-gated execution | ALiX denies what upstream permits | **ALiX stricter — must never be relaxed** |

### 4.1 The blocking finding

**Upstream explicitly reports unrestricted executor network access and Codex
running with its sandbox disabled**, and warns that public benchmark rubrics may be
reachable online (its own README). ALiX's root contract does the opposite:

- `alix_shell_run` enforces the same domain allowlist, DNS resolution and
  private/link-local rejection as `alix_web_fetch` — a model may not bypass SSRF
  controls by falling back to `curl`/`wget`/`ssh`.
- Workspace containment applies to approval-free shell reads.
- Fetched content is data, never instructions.

**Therefore: any uncontained Harness² probe is blocked for ALiX** (PRD §13.3).
Adopting the upstream default posture would be a security regression, and the PRD
pre-authorizes rejecting it.

### 4.2 Duplicate-authority finding

ALiX already owns "adopt an improvement only through governed decision": the
A-series evolution path and `ApprovalStore` decide promotion. Harness² maintains
its own improvement harness/store that adopts lessons automatically. Introducing
that as a second promotion authority would create exactly the duplicate decision
the PRD's Gate A forbids. **Recommendation: do not import the improvement harness.**

---

## 5. Verdict

- **PRE-R020: MET** — deterministic credential-free demo reproduced at a pinned
  commit, with artifacts and a stated environment caveat.
- **PRE-R021: MET** — components mapped, duplicate authority and unsafe-posture
  conflicts flagged explicitly.

**No ALiX change is proposed.** The research conclusion (see
`harness-optimization-readiness.md`) is **defer / reject for adoption**, keep the
reproduction as evidence that the concept is understood.

---

## 6. Reproducibility record

| Item | Value |
|---|---|
| Clone | shallow, `--depth 1` |
| Location | `/tmp/opencode/harness2-probe` (outside the repo; nothing committed from it) |
| Install log | `/tmp/opencode/h2-install.log` |
| Demo log | `/tmp/opencode/h2-demo.log` |
| Result | 2/2 tasks ok, 0 failed, 28 executions, 32 editor calls |
| Credentials used | **none** |
