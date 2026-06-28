# P5.2d — Batch Approval Design Spec (SDS) + Implementation Plan

> **Plan home:** `docs/superpowers/plans/2026-06-19-p5-2d-batch-approval.md`
> **Spec home:** `docs/superpowers/specs/2026-06-19-p5-2d-batch-approval-design.md`
> **Governs:** `feature/p5.2d-batch-approval` branch, off `main` at `3db78120`.

## Context

P5.2c introduced `AutomaticProposalGenerator` which can produce dozens of `pending` proposals at once. Approving them one-by-one (`alix adaptation approve <id1>`, then `<id2>`, etc.) is tedious and discourages humans from clearing auto-generated proposals. P5.2d adds **batch approval**: approve multiple proposals in one command, with per-proposal evidence (one `adaptation_approved` event per proposal), per-proposal error handling (best-effort, not all-or-nothing), and a shared `--by <actor>`. Still human-gated, still no auto-apply, still no auto-mutation. This is a **human efficiency tool**, not an autonomy step.

## Hard governance boundary

```
batch-approve  ≠  auto-approve
batch-approve  ≠  auto-apply
```

Every proposal is still individually checked for `status === "pending"` by `ApprovalGate.requirePending`. Each approval produces its own `change_type: "adaptation_approved"` evidence record. A proposal whose status isn't `pending` (e.g. already approved or rejected from a previous batch) is reported and skipped — the others proceed. **No `--apply` flag on the batch command.** Batch is for the approval gate only; apply remains one-at-a-time.

## Design decisions

### CLI shape

```
alix adaptation approve <id1> [id2] [id3] ... [--by <actor>]
```

Multiple positional IDs, whitespace-separated. Zero IDs → error + usage. `--by` applies to all approvals in the batch. This matches the existing `approve <id> [--by <actor>]` syntax — just extends it to accept more than one id.

No new flag names, no `--all` filter (that would cross into auto-approve territory; explicit IDs keep the human deliberate). No `--filter` (too close to auto-mutation). If auto-generated proposals need bulk clearing, the user pipes `alix adaptation list --status pending | grep prop- | awk '{print $1}' | xargs alix adaptation approve`.

### Gate surface

`ApprovalGate.approve(id, by)` remains unchanged (single-proposal, the existing workhorse). Add:

```ts
async approveBatch(ids: string[], by: Actor): Promise<{ approved: number; skipped: number; errors: { id: string; error: string }[] }>
```

This calls `this.approve(id, by)` in a loop, **not** a new batch store operation. Each call independently validates the proposal is pending, transitions status, and records evidence. If one proposal fails (not found or not pending), it's collected in `errors` and the loop continues. The method does NOT throw — it returns a result object the CLI uses to print a summary. This keeps `requirePending` as the single source of truth for the approve precondition.

Rationale for loop-over-approve rather than a single database transaction: (a) the store is append-only JSON files; there is no transactional boundary; (b) per-proposal evidence means each approval must produce its own `adaptation_approved` record; (c) failing one proposal should not roll back others — partial success is the correct governance artifact ("you approved 5 of 8; these 3 can't be approved because they're already rejected").

### Evidence

Each approved proposal in the batch produces one `adaptation_approved` evidence record via `this.writer.recordAdaptationApproved(...)` — same as the single-proposal path. No batch-level evidence event. Evidence is still per-proposal; the "batch" is only a CLI convenience.

### CLI wiring

Extend `runApprove` (currently in `src/cli/commands/adaptation.ts`). Currently:
```
async function runApprove(gate, args):
  const id = args[0];
  if (!id) error + exit
  const by = args.indexOf("--by") >= 0 ? args[byIdx + 1] : detectActor();
  await gate.approve(id, by);
  console.log(`Approved: ${updated.id} by ${updated.approvedBy}`);
```

New behavior: filter `args` to find all positional arguments that are NOT `--by <actor>`. Parse `--by` once. If one positional argument, call `gate.approve(id, by)` (backwards-compatible fast path). If multiple, call `gate.approveBatch(ids, by)`. Print a summary table:

```
Approved: 5/8
  Approved:  prop-2026-06-19-001, prop-2026-06-19-002, ...
  Skipped:  prop-2026-06-19-006 (already approved)
  Errors:   prop-2026-06-19-008 (not found)
```

### No new imports

`ApprovalGate` is already imported in `adaptation.ts`. The new `approveBatch` method lives inside `ApprovalGate`. No new modules.

### Summary

| Design | Decision |
|---|---|
| CLI syntax | `alix adaptation approve <id1> [id2] ... [--by <actor>]` |
| Gate method | `approveBatch(ids, by): { approved, skipped, errors }` — loops over `this.approve` |
| Error handling | Best-effort per proposal; partial success; errors collected (not thrown) |
| Evidence | One `adaptation_approved` per proposal (via `recordAdaptationApproved`, same as single) |
| No `--apply` | Batch is approval only; apply stays one-at-a-time |
| No `--all` / `--filter` | Explicit IDs keep the human deliberate |
| Backwards compat | `approve <id>` with one argument calls `gate.approve(id, by)` (unchanged) |

## Tasks

### Task 1: `ApprovalGate.approveBatch`
- Add `approveBatch(ids, by)` to `src/adaptation/approval-gate.ts`.
- Loop over `this.approve(id, by)`, catch individual errors, build result object.
- Does NOT throw — returns `{ approved, skipped, errors }`.
- Test: all succeed; some succeed + some not-found + some not-pending; empty ids.

### Task 2: CLI — extend `runApprove`
- Modify `src/cli/commands/adaptation.ts`: update `runApprove` to parse multiple positional ids (excluding `--by` flag), call `gate.approveBatch` for >1 id.
- Update help text in `printUsage`.
- Test: 1 id → fast path (single approve); 3 ids → batch; 0 ids → error; `--by` applies to all.

### Task 3: Integration verify + PR
- Full suite + tsc + detect_changes + PR
- Tag `alix-p5.2d-complete` on merge.
