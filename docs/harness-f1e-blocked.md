# F1-E — End-to-end cost qualification: BLOCKED

> ## SUPERSEDED — do not treat this as current status
>
> F1-E was subsequently **QUALIFIED 8/8** in an operator-assisted session. See
> **`docs/harness-f1e-qualified.md`** for the result and
> `benchmark/evidence/cost/cost-record.json` for the evidence (`run-79feb4e0`,
> $0.108968, completeness `complete`).
>
> This file is retained as history: it records the blocker, the unblock options
> considered, and why an offline mock could not substitute for a real billable
> call. Two real provider defects were found and fixed on the path to
> qualification.
>
> **Gate B is still HOLD** — but for cost *coverage* (1/10 strata), not because
> F1-E is blocked.

**Status (historical):** BLOCKED ON ENVIRONMENT — no reachable priced provider in this session.
**Branch:** `docs/pre-2.0-harness-audit`.

---

## 1. What was attempted

The approved plan was F1-E option 1: a small controlled real-model run through an
already-priced provider, to prove the full chain

```
runId → invocation + timestamp → usage → price at invocation time
      → independently recomputed cost → production summary + evaluation row
```

Before spending anything I audited which priced provider was actually usable.

### Provider availability audit

| Provider | In pricing catalog | Key configured | Key resolves | Usable |
|---|---|---|---|---|
| `openai` | **yes** (`gpt-4`, `gpt-4o`) | yes (`cred://openai/apiKey`) | **no** | **no** |
| `anthropic` | yes (3 models) | no | — | no |
| `openrouter` | no | yes (`cred://`) | **no** | no |
| `intern` | **no** (F1-D: subscription, no per-token rate) | not listed | — | no |
| `deepseek` | no | yes (`cred://`) | **no** | no |

**No provider key resolves in this session.** Every `cred://` reference fails
resolution because the credential store requires a passphrase
(`ALIX_CREDENTIAL_PASSPHRASE`, `backend-selection.ts:60-72`) that is not set, and
no store file is present on disk.

Prior Gate 7 real-model runs succeeded because they ran inside the operator's
interactive TUI session, where the keyring was already unlocked. This
non-interactive agent shell has no such access — which is correct behaviour, not a
defect: the store is doing exactly what it should.

### Attempted offline substitutes, and why each failed

| Substitute | Why it cannot prove F1-E |
|---|---|
| Scripted provider (`scripted-mock`) | Emits **no** `model.usage` events — the emit site is never reached |
| `mock` provider | Same: no usage reporting |
| Injected stub adapter into `runTask` | `runTask` builds its own adapter via `createProvider(config.provider)`; an injected adapter is not used (`registry.ts:57` throws for unknown providers) |

Only `unified-complete` parses `usage` from real API responses
(`provider-contract-validation.ts`, `types.ts` reference `inputTokens`), so
**usage events exist only for real provider calls**. There is no offline path.

---

## 2. What IS proven (carried from F1-A..F1-D)

The mechanism is verified at unit level, just not end-to-end through a live call:

| Link | Evidence | Status |
|---|---|---|
| `runId` reaches the emit site | `F1-A` — `context.runId` declared and attached; **red/green, 5 tests** | **Proven** |
| Concurrent workers keep distinct identities | `F1-A` — tests pin no cross-charging | **Proven** |
| Dated pricing selects the historical rate | `F1-D` — 10× case fixed, **red/green, 8 fail pre-fix** | **Proven** |
| Cost correlation joins run → usage → price | `P0-D4` — 13 tests, 13/13 real approvals verified | **Proven (synthetic events)** |
| Completeness semantics | `F1-C` — 14 tests, `complete/partial/non_billable/none` | **Proven** |
| Approval counts honest | `F1-B` — one `created` per request, red/green | **Proven** |

**Not proven:** that a *real provider's* usage event actually carries the `runId`
end to end, and that the live figure reconciles with the production summary. That
specific link requires one paid call.

---

## 3. Acceptance criteria — honest status

| # | Criterion | Status |
|---|---|---|
| 1 | Identity: correct run ID on every measured invocation | **UNVERIFIED live** (unit-proven) |
| 2 | Pricing: billed model matches an entry effective at invocation time | **UNVERIFIED live** (unit-proven) |
| 3 | Usage: observed tokens, not estimates | **UNVERIFIED live** |
| 4 | Accounting: each invocation once, including failed attempts | **UNVERIFIED live** |
| 5 | Independent recomputation matches | **UNVERIFIED live** |
| 6 | Production summary + eval row + independent calc agree | **UNVERIFIED live** |
| 7 | Negative cases remain unmeasured not zero | **PROVEN** (F1-C/F1-D tests) |
| 8 | Outcome integrity: task passes independent verification | **N/A** — no run |

Criterion 8 matters here: even a successful cost calculation would not have
established task success. **No run means no F1-E.**

---

## 4. What would unblock it

Either:

1. **Operator-assisted run.** The operator launches the TUI (keyring unlocked) and
   runs one minimal objective against a priced model. I provide the exact
   invocation, the expected evidence shape, and a verifier script that recomputes
   the cost independently. This is the cheapest path and uses the machinery that
   already works in Gate 7.
2. **Set `ALIX_CREDENTIAL_PASSPHRASE`** for a non-interactive session so
   `cred://` resolves. Only the operator can supply this; it must not be written
   to env files or the repo.

Both require operator action. Neither can be self-served from here without
weakening the credential boundary — which I will not do.

---

## 5. Safeguard adherence

- **No quota consumed.** Zero paid calls attempted, so no 429/503 risk.
- **No catalog edited to make a test pass.** `intern` remains unpriced.
- **No price invented.**
- **No credential boundary weakened** — I did not attempt to bypass the passphrase
  requirement, write a key to an env file, or copy a key out of the store.

---

## 6. Recommendation

**F1-E: BLOCKED, not failed.** The mechanism is proven piecewise; one live call is
missing and it needs operator participation for credential access.

Recommended next step is the operator-assisted run (option 1), because it proves
the chain with the same TUI path Gate 7 already exercised, and it keeps the
credential boundary intact.

After F1-E, per instruction, return to the missing behavioral strata
(2, 4, 5, 9, 10) before any ablation work.

Gate B HOLD. Simplification HOLD. Publication HOLD (Q13).
