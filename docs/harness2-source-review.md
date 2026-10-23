# Harness² source review (deliverable 9, PRE-R020–R021)

**Status:** Reproduced (demo) / contract map complete / **no ALiX change proposed**.
**Fresh reproduction artifact:** `benchmark/evidence/harness2-reproduction.json` (2026-10-23).
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

The credential-free deterministic demo was rerun on 2026-10-23 using the
already-present pinned checkout and Python virtualenv. Retained allowlisted
execution record: `benchmark/evidence/harness2-reproduction.json`.

- Source commit: `1cfe254e8d25b15f37048c3730134686abe60335`.
- Tracked source clean before execution; pre-existing untracked generated files
  recorded separately. No source edits or dependency installations in this pass.
- Python **3.12.3**; `pyproject.toml` requires `>=3.12,<3.14`, direct dependencies
  empty. Installed distribution names/versions recorded; fresh installation remains
  **unqualified**. Existing optional render packages do not prove necessity.
- New output: `/tmp/alix-harness2-repro-_3mzeh68/demo`; exit **0**.
- Result: **2 tasks completed, 0 failed; 28 executions, 32 editor calls**.
- Raw `demo.json`: 429 bytes; SHA256
  `ae26f2fd3fd8aa79e90662e560dae575b745b8d0563bb5ff042f32089f7c4da3`.

Reviewed `harness2/cli/demo.py`, `harness2/demo.py`, proposer initialization and
substrate construction before execution. `DemoProposer.call` makes scripted edits
and choices; `DemoAdapter.execute` launches the same Python executable against a
generated CSV arithmetic script. No provider/model invocation occurs on this path.
The child received only `PATH`, fresh temporary `HOME`, `PYTHONPATH` and
`PYTHONDONTWRITEBYTECODE`; no credential configuration or ambient keys were passed.
Network absence follows the reviewed execution path, not packet capture.
Upstream source and generated text were treated as data, not agent instructions.

Portable replay after separately obtaining the exact checkout and a compatible
Python environment (setup/install itself was **not** rerun or qualified):

```bash
# Run from a checkout of google-research/harness2 at this exact commit.
git rev-parse HEAD  # must equal 1cfe254e8d25b15f37048c3730134686abe60335
git diff --exit-code HEAD
repro_root=$(mktemp -d)
mkdir "$repro_root/home"
repro_python=$(command -v python3.12)
env -i PATH=/usr/bin:/bin HOME="$repro_root/home" \
  PYTHONPATH="$PWD" PYTHONDONTWRITEBYTECODE=1 \
  "$repro_python" -m harness2.cli.demo \
  --output "$repro_root/demo" --k 2 --mode both
sha256sum "$repro_root/demo/demo.json"
```

For this pass, `repro_python` was the existing
`/tmp/opencode/harness2-probe/.venv/bin/python`. The committed record includes its
exact command, dependency metadata, source/entrypoint hashes, stdout and result.
Artifacts remain under the new temporary output directory; the compact result is
retained in the repository so temporary cleanup does not erase the observation.

**Qualified:** deterministic recursion/library mechanics with real local Python
executions, both modes, pinned source, fresh output, retained result.
**Unqualified:** fresh dependency installation, model-backed benchmark setup,
model quality/cost/gains, and ALiX adoption. No ALiX runtime change is proposed.

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

`benchmark/evidence/harness2-reproduction.json` owns the fresh execution metadata,
allowlisted result, artifact hash, exact command and environment limitations.
Older `/tmp/opencode/h2-install.log` and `/tmp/opencode/h2-demo.log` remain historical
inputs; the new run does not retroactively qualify their installation claims.
