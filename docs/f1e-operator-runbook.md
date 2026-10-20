# F1-E operator runbook — priced-model cost proof

**Status:** READY FOR OPERATOR EXECUTION. No code change required.
**Baseline:** `ab363b35` in `/home/babasola/Projects/ALiX.pre2-audit`.
**Why this is operator-only:** the credential store requires an unlocked session.
This agent shell cannot resolve `cred://` references, and that boundary must not be
weakened to satisfy a benchmark.

---

## 1. Preconditions (verify before running)

| # | Requirement | How to confirm |
|---|---|---|
| 1 | TUI is running the **audit-branch build**, not the dirty root | `cd /home/babasola/Projects/ALiX.pre2-audit && git rev-parse HEAD` → `ab363b35…` |
| 2 | That build is compiled | `./node_modules/.bin/tsc -p tsconfig.json` (already done; `dist/` carries `costCompleteness`, `runId` on usage, `approval.reused`) |
| 3 | A priced provider is reachable in your unlocked session | `openai` (`gpt-4o`, `gpt-4`) or `anthropic` are the only catalog-priced providers |
| 4 | Target model has an effective-dated catalog entry | `gpt-4o` → $2.50 in / $10.00 out per Mtok, effective `2025-01-01` |
| 5 | Workspace is disposable, **not** the dirty root | create a fresh dir, e.g. `/tmp/opencode/f1e-workspace` |

If the TUI is launched from the root checkout, the run will **not** carry the F1-A
telemetry and the proof fails at check 2. Point it at the audit worktree.

---

## 2. The run

**Workspace:** a fresh disposable directory. Do not use `/home/babasola/Projects/ALiX`.

**Config** (`.alix/config.json` in the workspace):

```json
{
  "models": { "default": { "provider": "openai", "name": "gpt-4o" } },
  "permissions": { "default": "ask", "sessionMode": "ask" },
  "context": { "repoMap": false, "semanticSearch": false }
}
```

**Objective** (exactly this):

> Create `f1e-cost-proof.txt` in the designated test workspace containing exactly `F1E_COST_PROOF_OK`. Verify the file content and report completion.

**Parameters:**
- One worker; no coordination run needed (a plain single-agent turn is sufficient
  and cheaper — the chain under test is `runId → usage → pricing`, which a direct
  turn exercises).
- Normal policy. **Do not use bypass.**
- Approve normally through the TUI.
- No retries unless existing policy requires one.

**Cost expectation:** one small invocation. `gpt-4o` at $2.50/Mtok input means a
few thousand tokens is well under one cent.

---

## 3. Capture these five things

1. **The workspace path** (e.g. `/tmp/opencode/f1e-workspace`)
2. **The run id** — from the session events, the `runId` field on the
   `model.usage` event (this is the authoritative identity F1-A now attaches)
3. **The raw session events** — `.alix/sessions/<id>/events.jsonl` (sanitized:
   contains no API key; safe to hand over)
4. **The artifact** — `f1e-cost-proof.txt`
5. **The production summary** — from `alix observability export` or the TUI cost
   panel

---

## 4. Verification (run this yourself, or hand the records over)

```sh
cd /home/babasola/Projects/ALiX.pre2-audit

ALIX_DIST=$PWD/dist node docs/verify-f1e-cost-proof.mjs \
  <workspace-path> <run-id>
```

The verifier reads **sanitized events only**. It never reads an API key, never
calls a provider, and never writes to the workspace.

### The eight checks

| # | Check | Why it matters |
|---|---|---|
| 1 | A real billable provider responded | Guards against a mock run being counted |
| 2 | `model.usage` carries the authoritative `runId` | Proves F1-A in a live run |
| 3 | Usage identifies provider, model, timestamp | Required for dated pricing |
| 4 | Catalog resolves a rate **effective at invocation time** | Proves F1-D live |
| 5 | Tokens reproduce a dollar amount | Independent recomputation |
| 6 | Canonical observation == production summary | The two paths must agree |
| 7 | Artifact contains `F1E_COST_PROOF_OK` | Task success, not just cost |
| 8 | No unrelated invocation included | No cross-run contamination |

**All eight must pass.** A correct file write alone is insufficient; a correct cost
with a missing artifact is insufficient.

### Verified non-passer

The verifier was tested against the recorded `f8b-final` session (a pre-F1-A run
using `intern`) and correctly reports **3 passed / 5 failed**: no `runId` on
usage, `intern` unpriced, artifact absent. It does not produce a false pass.

---

## 5. If it fails

| Failure | Meaning | Action |
|---|---|---|
| Check 2 fails | TUI ran the wrong build | Re-run from the audit worktree |
| Check 4 fails | Model has no effective-dated price | Switch to `gpt-4o`/`gpt-4` |
| Check 6 fails | Canonical and production disagree | Report it — that is a real finding |
| 429 / 503 | Provider unavailable | **Stop.** Record as infrastructure-blocked; do not retry in a loop |

Never edit the pricing catalog to make the check pass. If the selected model lacks
verifiable pricing, choose another qualified model.

---

## 6. What a pass establishes

- ALiX produces a defensible, independently recomputable real-model cost observation.
- `runId`, dated pricing, usage and completeness all hold on a live call.

**What it does not establish:** Intern pricing, full 10-stratum cost coverage,
performance thresholds, or any comparative advantage. Those remain Gate B work.

---

## 7. Meanwhile — what I will do while this is blocked

Per instruction, strata 2, 4, 5, 9 and 10 case development may proceed
independently. Those will be deterministic (scripted-provider) cases and will
**not** claim real-model cost qualification.
