# FINDING — delegate-driver cost is unattributable (blocks metered cost for 5 strata)

**Status:** OPEN — structural. Found before spending money, not after.
**Recorded:** 2026-10-20
**Affects:** strata 4, 5, 7, 10 (all `delegate`-driver cases)

---

## 1. The finding

A `delegate` eval case makes a **real billable call** but its usage cannot be
attributed to the run and its evidence is then **deleted**. Running delegate
cases on a priced model would spend money and produce nothing measurable.

## 2. The chain, verified in source

| Step | Source | What happens |
|---|---|---|
| 1 | `drivers/delegate-driver.ts` | `contextBundle: \`eval:${evalCase.id}\`` |
| 2 | `agents/subagent-manager.ts` | `"--session-id", task.contextBundle ?? …` — the child's session id is the *context bundle string*, not the parent session |
| 3 | `agents/subagent-cli.ts` | child writes `model.usage` into its **own** cwd's session dir |
| 4 | `evals-runner.ts` | `rmSync(cwd, { recursive: true, force: true })` in `finally` — the child's session dir is removed |

**Step 4 was fixed for the main-loop path** (`eval-usage.ts` captures usage before
cleanup). The delegate path still needs steps 1–2 fixed: even with capture in
place, the child writes to a different session with no parent `runId`, so its
usage is not in the directory the parent captures.

`runId` is additionally absent: `deps.context.runId` is populated on the
main-loop path; the delegate path never sets it. So even if the events survived,
correlation would report `no-run-id`.

## 3. Why this matters

Strata 4, 5, 7 and 10 have **deterministic coverage but no way to measure cost**.
The coverage work was real; the measurement path was never wired for the delegate
driver.

This is the same class as F1-A (`runId` declared but unattached): the identity
exists in principle but is not threaded where it is needed.

## 4. What would fix it

The child's usage must reach the parent's authoritative session and carry the
parent's `runId`. Options, none implemented:

1. **Pass the parent session + runId to the child** via env, so it appends usage
   to the parent's event log. Requires deciding whether a child may write to the
   parent's log (currently it does not — a deliberate boundary).
2. **Have the child report usage in its structured result** and let the parent
   append it. Keeps the write boundary intact; needs a result-field contract.
3. **Capture the child's session dir before cleanup** and correlate post-hoc.
   Cheapest, but leaves two logs to join and still lacks `runId` unless (1)/(2)
   also lands.

Option 2 is the least invasive and is the one to evaluate first, since
`SubagentResult` already crosses the boundary.

## 5. What was NOT done

- No production change. This is a recorded finding, not a fix.
- No delegate case was run on a priced model. **No money was spent** discovering
  this; it was found by reading the spawn and cleanup paths.
- The 2 main-loop cases were measured instead (`read-only`, `code-navigation`).
  That path was wired *during this investigation*, not before it: the first
  attempt captured nothing because `rmSync` ran before any read. Usage capture
  (`src/operations/evals/eval-usage.ts`) now runs ahead of cleanup, and the
  measured result is `benchmark/evidence/cost/eval-mainloop-metered.json`.

## 6. Gate B effect

Unchanged verdict (HOLD), but the blocker is now precisely scoped: measured cost
is possible for main-loop strata today and structurally impossible for delegate
strata until one of the options above is implemented. "Run the remaining strata
on a priced model" is therefore **not** a pure budget decision — five of them need
code first.
