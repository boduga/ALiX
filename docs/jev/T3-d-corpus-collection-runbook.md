# T3-d Corpus Collection Runbook

Operational procedure for collecting the T3 corpus defined in
`T3-selection-evaluation-preregistration.md`. The preregistration owns the
policy (what may be counted, how it is labelled, the checkpoint); this runbook
owns execution only. It does not reinterpret either.

## 1. Cohort contract

A cohort is the set of scopes collected under one immutable header. Record it
before the first run:

```json
{
  "cohortId": "t3d-2026-09-28-a",
  "gitRevision": "<git rev-parse HEAD>",
  "projectorVersion": "tool-selection/v1",
  "jevModel": "<exact model/version>",
  "jevConfigHash": "<hash of the decision/Jev config>",
  "candidateSchemaVersion": "<candidate-freeze schema version>",
  "startedAt": "<ISO-8601>"
}
```

Stored at `docs/jev/cohorts/<cohortId>.header.json`. How to obtain each field:

```bash
git rev-parse HEAD                          # gitRevision
alix jev status                             # jevModel + the active config
sha256sum config.json                       # jevConfigHash (repo config used)
grep -n "tool-selection/v1" src/planning/decision/tool-selection-experiment.ts
```

**Immutability.** If any header field changes, open a new cohort. Never extend
an existing cohort across a revision, projector, model/config, or candidate-schema
change, and never mix rows from two cohorts in one report. A cohort is closed
when its scope count reaches the plan, or when a header field moves — whichever
comes first.

## 2. Workload matrix (40 tasks)

Five families × 8 tasks. Each family is internally varied: different prompt
shapes, different deliverable types, not eight phrasings of one request.

| Family | Tasks | Target scopes | What it exercises |
|---|---|---:|---|
| Read/search | `r1`–`r8` | 8 | file read, grep, glob, directory search |
| Verification | `v1`–`v8` | 8 | test runs, claim verification, shell verification |
| Mutation | `m1`–`m8` | 8 | create/patch/delete + read-back verification |
| Coordination | `c1`–`c8` | 8 | multi-agent planning/execution, requirement candidates |
| MCP/external | `x1`–`x8` | 8 | sanitized MCP candidates, external availability |

Multi-iteration requirement: at least **14** of the 40 (marked
`multiIterationExpected: yes`), distributed across families — 2 read/search,
3 verification, 3 mutation, 4 coordination, 2 MCP/external.

Task entries carry exactly these fields:

```text
taskId, family, prompt, expectedMode, multiIterationExpected, MCPExpected,
requirementClassExpected (optional, diagnostic only)
```

**Never encode an expected winning tool.** A prompt that names the tool it
expects contaminates the later blind labelling — the point of T3-b is that the
operator judges the two candidates without a planted answer.

### Read/search (`r1`–`r8`)

| taskId | prompt | mode | multi | MCP |
|---|---|---|---|---|
| `r1` | Summarize what `src/planning/decision/tool-selection-corpus.ts` defines, section by section. | read-only | no | no |
| `r2` | Find every reference to `tool.selection.observed` repo-wide and group them by file. | read-only | no | no |
| `r3` | Identify which test files under `tests/run/` exercise the tool-selection experiment surface. | read-only | no | no |
| `r4` | Locate the definition of `ToolSelectionScope` and every function that consumes it. | read-only | no | no |
| `r5` | Explain the difference between `scopeId` and `projectionHash` as used in this repo. | read-only | no | no |
| `r6` | List the files under `src/planning/decision/` longer than 200 lines with their line counts. | read-only | no | no |
| `r7` | Trace how a `tool.selection.observed` event is produced, from the runtime call site to the JSONL store. | read-only | **yes** | no |
| `r8` | Compare the contracts in `src/planning/decision/AGENTS.md` and `src/execution/run/task-loop/AGENTS.md` and report every place they disagree. | read-only | **yes** | no |

### Verification (`v1`–`v8`)

| taskId | prompt | mode | multi | MCP |
|---|---|---|---|---|
| `v1` | Run the tool-selection replay test file and report the exact pass/fail counts. | read-only | no | no |
| `v2` | Run `pnpm typecheck:unused` and report whether it passes. | read-only | no | no |
| `v3` | Verify that the exclusion vocabulary in `src/planning/decision/tool-selection-corpus.ts` contains exactly the seven preregistered codes. | read-only | no | no |
| `v4` | Check whether any file outside `src/planning/decision/` imports the tool-selection scorer or the replay engine. | read-only | no | no |
| `v5` | Confirm or refute: "`scripts/tool-selection-sample.mjs` never writes outside the path passed with `--out`." Cite the source lines. | read-only | **yes** | no |
| `v6` | Verify that `.gitignore` ignores repo-root `.tmp/` and `.alix/`. | read-only | no | no |
| `v7` | Determine whether the T3 checkpoint (30 eligible scopes, 10 labelled disagreements) is met by the current corpus, and report the numbers. | read-only | **yes** | yes |
| `v8` | Re-derive the four per-scope statuses for the current corpus and report every row where the trace is complete but the selection comparison is not eligible. | read-only | **yes** | no |

### Mutation (`m1`–`m8`) — all writes stay under `.tmp/t3d/<taskId>/`

| taskId | prompt | mode | multi | MCP |
|---|---|---|---|---|
| `m1` | Create `.tmp/t3d/m1/notes.md` with a three-line summary of the cohort contract. | mutating | no | no |
| `m2` | Create `.tmp/t3d/m2/ledger-schema.md` listing the ledger collection fields from this runbook. | mutating | no | no |
| `m3` | Create `.tmp/t3d/m3/count.txt` containing the number of tasks in the mutation family, then read it back. | mutating | no | no |
| `m4` | Create `.tmp/t3d/m4/a.md` and `.tmp/t3d/m4/b.md`, then delete `b.md` and report what remains. | mutating | **yes** | no |
| `m5` | Create `.tmp/t3d/m5/draft.md`, then patch its first paragraph to add a caveat about circular fixture metrics. | mutating | **yes** | no |
| `m6` | Write `.tmp/t3d/m6/report.json` holding the current corpus agreement rate and labelled-disagreement counts. | mutating | **yes** | no |
| `m7` | Create `.tmp/t3d/m7/README.md` describing the cohort run controls, then read it back and confirm the content matches. | mutating | no | no |
| `m8` | Create `.tmp/t3d/m8/old.md`, rename it to `new.md`, and report the final directory listing. | mutating | no | no |

### Coordination (`c1`–`c8`) — the expensive family; each spawns workers

| taskId | prompt | mode | multi | MCP |
|---|---|---|---|---|
| `c1` | Plan and execute a two-worker run writing `.tmp/t3d/c1/left.md` and `.tmp/t3d/c1/right.md` independently. | coordination | **yes** | no |
| `c2` | Plan a three-worker run producing `.tmp/t3d/c2/a.md`, `b.md`, `c.md` and report the dependency order assigned. | coordination | **yes** | no |
| `c3` | Plan a run where one worker writes `.tmp/t3d/c3/source.md` and a dependent worker summarizes it into `.tmp/t3d/c3/summary.md`. | coordination | **yes** | no |
| `c4` | Plan a coordination run with two writers whose scopes overlap, and report how the planner orders them. | coordination | **yes** | no |
| `c5` | Execute a two-worker coordination run and report each worker's outcome plus the aggregate status. | coordination | no | no |
| `c6` | Plan a coordination run whose dependency cannot be satisfied, and report the blocking behaviour. | coordination | no | no |
| `c7` | Plan a four-worker run over `.tmp/t3d/c7/` and report the ownership scopes it assigns. | coordination | no | no |
| `c8` | Run a coordination task whose outputs require verification, and report whether verification candidates appear in its scopes. | coordination | no | no |

### MCP/external (`x1`–`x8`) — requires network; SSRF/allowlist policy still applies

| taskId | prompt | mode | multi | MCP |
|---|---|---|---|---|
| `x1` | Discover which MCP tools are available in this workspace and list them by server. | read-only | no | yes |
| `x2` | Fetch `https://example.com` with an available external tool and report the HTTP status. | external | no | yes |
| `x3` | Search the web for the TypeSafe System One pricing page and report the headline claim. | external | no | yes |
| `x4` | Use an MCP search tool to find documentation for Model Context Protocol versioning. | external | no | yes |
| `x5` | Fetch a public JSON endpoint and report its top-level keys. | external | no | yes |
| `x6` | Attempt an external fetch of `http://127.0.0.1:1/` and report the refusal mode. | external | no | yes |
| `x7` | Use an external tool to read a URL, then cross-check one claim from it against a local file. | external | **yes** | yes |
| `x8` | Report which external tools were offered versus excluded in the most recent scope, with the exclusion reasons. | read-only | **yes** | yes |

## 3. Per-run procedure

Run every task from the cohort's revision, in this worktree.

```bash
# 0. Freeze the header before the first task (section 1).
mkdir -p docs/jev/cohorts .tmp/t3d/logs

# 1. Record the scope count before the task, so the new session is unambiguous.
ls -1 .alix/sessions | wc -l

# 2. Run the task. Read-only families use --read-only; mutation/coordination
#    run in the normal write mode. `--mode bypass` keeps an unattended batch
#    from stalling on an approval prompt; pair it with --read-only wherever the
#    task does not need to write, and keep mutations inside .tmp/t3d/<taskId>/.
#
#    ALIX_TOOL_SELECTION_TRACE=1 is REQUIRED for collection. Tool-selection
#    tracing is off by default — it is per-turn telemetry for an experiment T3
#    concluded `experiment-only`, with no runtime reader. Without the flag every
#    `grep -c 'tool.selection.observed'` in step 3 returns 0 and the run is
#    untaggable, so set it for the whole batch, not per task.
#
#    NOTE: `alix run --help` is not a help flag — it starts a run with "--help"
#    as the task text. Do not use it to inspect usage.
ALIX_TOOL_SELECTION_TRACE=1 node bin/alix.js run "<prompt from the matrix>" \
  --read-only --mode bypass --no-stream \
  2>&1 | tee .tmp/t3d/logs/<taskId>.log

# 3. Capture the session id from the run output (`Session: <id>`) and confirm
#    the session produced a scope. The line is not always at the start of a
#    line — it follows the streamed summary without a newline — so match the id
#    shape rather than anchored text.
SESSION=$(grep -oE 'Session: [0-9a-f-]{36}' .tmp/t3d/logs/<taskId>.log | tail -1 | awk '{print $2}')
echo "$SESSION"
grep -c 'tool.selection.observed' .alix/sessions/"$SESSION"/events.jsonl

# 4. Record the mapping in the cohort manifest (sessionId -> taskId, family,
#    expected fields) immediately. Do not batch this to the end: a run without
#    a recorded task identity cannot be tagged later.
```

Manifest shape (`docs/jev/cohorts/<cohortId>.manifest.json`, keyed by session):

```json
{
  "<sessionId>": {
    "taskId": "r7",
    "family": "read/search",
    "expectedMode": "read-only",
    "multiIterationExpected": true,
    "MCPExpected": false,
    "requirementClassExpected": null,
    "producedScope": true
  }
}
```

Scopes are produced only by real runs; a task that yields no
`tool.selection.observed` event is a **trace-completeness failure**, recorded as
such (it is evidence about instrumentation), never silently dropped.

After the batch:

```bash
node scripts/tool-selection-sample.mjs \
  --session <id> [--session <id> ...] \
  --engine jev \
  --out .alix/<cohortId>-corpus.json
```

## 4. Tagging rules

- One task may produce several scopes (multi-iteration). Every frozen scope in
  that session inherits the session's `taskId` and `family`; the scope's own
  `iteration` distinguishes them.
- A task that produced no scope still appears in the manifest, marked
  `producedScope: false`, with the reason.
- `requirementClassExpected` is diagnostic only. A mismatch between expected and
  detected requirement classes is an observation about requirement detection —
  never evidence about the selector.
- Scratch paths are namespaced per task (`.tmp/t3d/<taskId>/`). A mutation task
  that writes outside its namespace is recorded as a containment observation.

## 5. Failure and retry rules

- **A failed Jev scope is recorded as-is.** Never retry a scope inside the same
  corpus row and replace the failure: that makes the completion-rate metric
  artificially optimistic.
- An operational retry is a **new sample identity** (new run, new session, new
  scope row). Both the failure and the retry are reported; the failure is never
  erased.
- The same rule applies to a transient scorer failure (pilot `8a0de18b`: a
  timeout and an MCP fetch failure in one attempt, then a clean attempt later).
  The failed attempt stays in the record.
- A row excluded from comparison keeps its diagnostics; exclusion is not
  deletion.
- If Jev's full-scope completion rate falls below what T4 needs, that is a T3
  finding about the selector, not an implementation nuisance to hide.

## 6. Ledger schema

One JSONL row per frozen scope, at
`docs/jev/cohorts/<cohortId>.ledger.jsonl`.

Collection facts (projected from the corpus + manifest, never hand-typed;
`taskId`/`family` come from the cohort manifest keyed by `sessionId`):

```text
cohortId, sessionId, scopeId, taskId, family, iteration,
offeredCount, builtinCount, mcpCount, requirementCandidateCount,
actualCandidateId, jevTopCandidateId, actualVsJevAgree,
candidateSetPreserved, selectionEligible, outcomeEligible,
eligibilityReason, diagnostics[],
attemptedCandidates, failedCandidates,
scopeLatencyMs, medianCandidateLatencyMs, p95CandidateLatencyMs
```

Label state (appended later, blind labels committed before the reveal):

```text
blindLabelStatus, actualAppropriateness, jevAppropriateness,
gapClosure, labelledAt
```

Collection facts and judgments stay in separate fields so a report can never
read a judgment out of a measurement.

Projection from the corpus (no new tooling; promote to `scripts/` if it is used
more than twice):

```bash
python3 - <<'PY'
import json, math, statistics
corpus = json.load(open(".alix/t3d-<cohort>-corpus.json"))
labels = {}
try:
    for line in open(".alix/t3-labels.jsonl"):
        r = json.loads(line); labels[r["scopeKey"]] = r
except FileNotFoundError:
    pass
manifest = {}
try:
    manifest = json.load(open("docs/jev/cohorts/t3d-<cohort>.manifest.json"))
except FileNotFoundError:
    pass
for row in corpus["rows"]:
    lat = (row.get("scoring") or {}).get("latencyMs", [])
    lat = sorted(lat)
    def p(f):
        if not lat:
            return None
        return lat[min(len(lat) - 1, max(0, math.ceil(f * len(lat)) - 1))]
    key = f'{row["sessionId"]}:{row["scopeId"]}'
    label = labels.get(key)
    actual_id = (row.get("actual") or {}).get("candidateId")
    jev_id = ((row.get("alternative") or {}).get("ranking") or [None])[0]
    # Slots are blind; map them back only through the recorded order, exactly as
    # resolveDisagreementLabels does in src/planning/decision/tool-selection-corpus.ts.
    actual_app = jev_app = None
    if label and label.get("kind") == "disagreement":
        order, labs = label["order"], label["labels"]
        if order[0] == actual_id:
            actual_app, jev_app = labs["a"], labs["b"]
        elif order[1] == actual_id:
            actual_app, jev_app = labs["b"], labs["a"]
    print(json.dumps({
        "cohortId": "t3d-<cohort>",
        "sessionId": row["sessionId"], "scopeId": row["scopeId"],
        "taskId": manifest.get(row["sessionId"], {}).get("taskId"),
        "family": manifest.get(row["sessionId"], {}).get("family"),
        "iteration": row["iteration"],
        "offeredCount": len(row["offered"]),
        "builtinCount": row["domains"]["builtin"], "mcpCount": row["domains"]["mcp"],
        "requirementCandidateCount": len(row["requirementCandidates"]),
        "actualCandidateId": actual_id,
        "jevTopCandidateId": jev_id,
        "actualVsJevAgree": jev_id == actual_id,
        "candidateSetPreserved": (row.get("alternative") or {}).get("candidateSetPreserved"),
        "selectionEligible": row["eligibility"]["selection"] == "eligible",
        "outcomeEligible": row["eligibility"]["outcome"] == "eligible",
        "eligibilityReason": row["eligibility"].get("reason"),
        "diagnostics": row["eligibility"].get("diagnostics", []),
        "attemptedCandidates": (row.get("scoring") or {}).get("attemptedCandidates"),
        "failedCandidates": (row.get("scoring") or {}).get("failedCandidates"),
        "scopeLatencyMs": sum(lat) if lat else None,
        "medianCandidateLatencyMs": statistics.median(lat) if lat else None,
        "p95CandidateLatencyMs": p(0.95),
        # Label state, empty until the blind cards are committed.
        "blindLabelStatus": "labelled" if label else "pending",
        "blindOrder": (label or {}).get("order") if (label or {}).get("kind") == "disagreement" else None,
        "actualAppropriateness": actual_app,
        "jevAppropriateness": jev_app,
        "gapClosure": (label or {}).get("gapClosure") if (label or {}).get("kind") == "gap-closure" else None,
        "labelledAt": (label or {}).get("labelledAt"),
    }))
PY
```

## 7. Checkpoint commands

```bash
# Facts footer: statuses, preservation/completion rates, agreement, latency,
# prerequisites (checkpoint 30 eligible scopes / 10 labelled disagreements).
node scripts/tool-selection-label.mjs --corpus .alix/<cohortId>-corpus.json --report

# Disagreements awaiting a label.
node scripts/tool-selection-label.mjs --corpus .alix/<cohortId>-corpus.json --list

# Blind card (A/B rotation is derived from the scope key; no provenance shown).
node scripts/tool-selection-label.mjs --corpus .alix/<cohortId>-corpus.json --card <sessionId>:<scopeId>

# Commit the labels (this is what reveals which side was which).
node scripts/tool-selection-label.mjs --corpus .alix/<cohortId>-corpus.json \
  --label <sessionId>:<scopeId> --a <appropriate|inappropriate|unclear> --b <appropriate|inappropriate|unclear>

# Offline objective-gap-closure label (outcome-eligible scopes only).
node scripts/tool-selection-label.mjs --corpus .alix/<cohortId>-corpus.json \
  --gap <sessionId>:<scopeId> --closure <closed|not_closed|unknown>
```

T4's headline is a first-class collection metric, in both directions: quality
(agreement, labelled disagreements) **and** cost (`scopeLatencyMs`,
candidate latency, candidate count, full-scope completion rate). A selector that
wins on quality but needs ~6.5 s of ranking per scope has not yet earned T4.
