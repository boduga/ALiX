# Partial-Status & Objective-Aware Subagent Completion — Design

Date: 2026-08-17 · Branch: `worktree-partial-status` · Issues: follow-up to #567 (PR #568 squash-merged `5be4f263`)

## Problem

`#567` introduced the rule **failed iff a write tool failed** — `computeSubagentStatus(fatalWriteFailures.length > 0 ? "failed" : "success")`. A live v3 run exposed a false negative: the requested change **landed** (`verify-scratch.ts` → `const target = 42;`), but the worker reported `status: "failed"` because the *model* (not ALiX — there is no runtime retry) emitted further `patch.apply` calls **after** the successful write, and those failed:

1. `patch target=42` → `patch.applied`, file updated.
2. `patch` (malformed closer) → `No patch changes found`.
3. `patch` (searches `const target = 1;`) → `Search block not found` (file already `42`).
4. Loop ended → `fatalWriteFailures = ["patch.apply"]` → `failed`. Exit 1.

The bug: **ALiX treats the existence of later failed model-generated writes as evidence that the original delegated objective failed.**

The model is allowed to keep emitting tools after a successful mutation (legitimate multi-file workers must keep running). Failed later writes are model noise, not proof the objective failed.

## Design (all decisions locked with the user)

### Core correction — objective-aware completion

Replace single-ledger accounting with **dual, independent tracking** of durable write progress and write failures:

```ts
type WriteProgress = {
  successfulPaths: Set<string>;   // paths affected by successful write calls
  fatalWriteFailures: string[];   // names of write tools that failed (unchanged semantics)
};
```

Each successful write contributes its **actual affected paths** to `successfulPaths` — the status calculation does not care which tool performed the mutation:

| tool           | affected-paths source                          |
|----------------|------------------------------------------------|
| `file.create`  | `ToolResult.createdPath` (fallback `changedFiles`) |
| `file.delete`  | `ToolResult.deletedPath` (fallback `changedFiles`) |
| `patch.apply`  | `ToolResult.changedFiles` (`tool-router.ts:349`)    |

### Objective = owned-path coverage

The delegated objective in write mode is a **deterministic filesystem contract**: every `--owned-paths` entry must appear (by canonical path) in the union of paths affected by successful writes.

```
objectiveComplete =
  ownedPaths.length === 0 ||
  ownedPaths.every(owned => successfulPaths.some(sp =>
    sp === canonical(owned) || sp.startsWith(canonical(owned) + "/")))
```

This is exactly what distinguishes the two cases:
- **v3:** owned `[verify-scratch.ts]`, successful `{verify-scratch.ts}` → **complete** → `success` (later failed patches ignored for completion).
- **foo/bar:** owned `[foo.ts, bar.ts]`, successful `{foo.ts}` → **incomplete** → `partial`.

No `done`-tool reliance (v3 never called `done`) and no LLM judge.

### Status determination matrix

```
successfulPaths  fatalWriteFailures  coverage      status
     0                 0                —          success
     0                 >0               —          failed
    >0                 0              complete     success
    >0                 >0             complete     success   ← v3
    >0                 —              incomplete   partial   ← new (incl. 0 fatal failures)
```

**Rules locked by the user:**
1. Fatal write failures do **not** independently determine failure once durable progress exists — they matter only when evaluating whether the objective remains incomplete.
2. `partial` = durable progress + incomplete owned-path objective. It does **not** require `fatalWriteFailures > 0` (foo.ts changed, bar.ts never attempted, model stops → still `partial`).
3. A completed objective remains `success` despite later model-generated write noise.
4. No hard "stop after first write" guard — legitimate multi-file workers keep running.

### Invariant

> A successful mutation cannot subsequently be converted into `failed` merely because the model emits additional unsuccessful mutations, when the original delegated objective has already been satisfied.

## Status contract across layers

| Layer                  | partial behavior                                                            |
|------------------------|-----------------------------------------------------------------------------|
| `SubagentResult.status` | `"success" \| "failed" \| "rejected" \| "partial"` (`schema.ts:271`)        |
| worker process exit     | `1` (partial is not a clean process-level success; success→0, failed/rejected/partial→1) |
| `SubagentManager`       | preserves child-reported `partial` (add to the parsed-status whitelist)     |
| delegate `ToolResult`   | `kind: "success"` — **not** a retryable error — with explicit partial details in output |
| parent LLM              | sees what landed and what remains incomplete                                |

**Locked invariants:**
- `ToolResult` stays binary `success | error` — no new kind (avoids the ~10 `kind`-narrowing ripple through executor/route-execution/event-handlers/continuation-manager).
- A partial result MUST NOT be represented to the parent as a retryable tool error (that would invite the parent to re-attempt already-landed writes — recreating the bug).

## Path normalization

Both sides **must** be canonicalized by the same function before coverage is evaluated:

```ts
function canonical(cwd: string, path: string): string {
  return path.startsWith("/") ? path : resolve(cwd, path);
}
```

- Reuse the existing `resolvePolicyPath(cwd, path)` (`policy-gate.ts:71`, currently module-private) — **export it** and import where coverage is evaluated. This guarantees coverage semantics match the approval semantics (#566): the same comparison shape as `isWithinOwned` (`policy-gate.ts:90`), i.e. equality-or-direct-child.
- Owned paths arrive project-relative (`--owned-paths verify-scratch.ts`); `changedFiles`/`createdPath`/`deletedPath` may be relative (search_replace block path as the model wrote it) or absolute (`resolvePatchPath` output). Mixed forms are why normalization is mandatory.
- Where the evaluation lives, the worker's `projectRoot` (= `process.cwd()`) is the canonical `cwd`.

## Files to change

| File | Change |
|------|--------|
| `src/config/schema.ts:271` | add `"partial"` to `SubagentResult.status` |
| `src/policy/policy-gate.ts:71` | `export` `resolvePolicyPath` |
| `src/agents/subagent-cli.ts` | `WriteProgress` ledger; collect successful paths during the tool loop; new `computeSubagentStatus(progress, ownedPaths, cwd)`; `buildResult` threads progress; exit-code: partial→1; `formatSubagentResult` partial→ findings + `[partial]` note |
| `src/agents/subagent-manager.ts:127` | add `"partial"` to parsed-status whitelist |
| `src/agents/delegate-tool.ts:46` | `partial` → `kind: "success"` with explicit `[partial] … Changed/Untouched/Write failures` output |
| tests | `subagent-cli.test.ts` (matrix + normalization + extraction), `subagent-manager.test.ts` (preserves partial), `delegate-tool.test.ts` (partial → success-with-warning) |

`result-contract-validator.ts`: treat `partial` like `success` for finding-based checks (expected-output / no-findings warnings) — no behavioral change otherwise.

## Testing

- **Unit — status matrix:** v3 → `success`; foo/bar → `partial`; foo-touched-bar-never-attempted → `partial`; no-progress+write-failure → `failed`; clean → `success`; `ownedPaths=[]` → success.
- **Unit — normalization:** relative vs absolute successful-path forms; owned-directory prefix match (`src/` covers `src/foo.ts`); non-overlapping paths stay incomplete.
- **Unit — path extraction:** `patch.apply` changedFiles; `file.create` createdPath; `file.delete` deletedPath; success without path credits nothing.
- **Unit — delegate mapping:** partial → `kind:"success"`, output contains `[partial]`, lists untouched path; failed → `kind:"error"` unchanged.
- **Unit — manager:** parses child-reported `partial` status and preserves it (both exit 1 and exit 0 variants).
- **Integration (manual on desktop, keyring unlocked):** re-run the v3 worker invocation — expected `status: "success"` (sole owned path covered), i.e. the false negative disappears, despite the later failed patch attempts; a synthetic foo/bar prompt (two owned paths, one landed, one failed) → `partial`.

## Non-goals

- No third `ToolResult` kind.
- No hard stop after first write.
- No LLM judge / no `done`-tool objective determination.
- No change to retry semantics (`retryable` remains a model-side hint).
- `rejected` stays untouched (adaptation/proposal domain; nothing in the subagent path emits it).
