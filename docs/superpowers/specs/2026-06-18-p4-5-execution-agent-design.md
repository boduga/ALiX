# P4.5g — ExecutionAgent: System Design Addendum

**Date:** 2026-06-18
**Status:** Draft
**Prerequisite:** P4.5c–f (Coordinator, Intake, Planning, Review, PR) ✅
**Branch:** `feature/p4.5-execution-agent`

---

## Q1: What files may it modify?

**Only files explicitly listed in the approved `ExecutionPlan.subtasks[].files`.**

Any file outside that set is a trust violation. Protected paths are enforced
by the ExecutionAgent itself (not just the ReviewAgent):

| Path | Rule |
|------|------|
| `src/security/` | REJECT — trust boundary |
| `src/config/` | REJECT — config signing boundary |
| `src/agents/` | REJECT — agent identity boundary |
| `src/workflow/` | REJECT — governance boundary |
| `.alix/` | REJECT — evidence + state boundary |
| `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` | REJECT |

Enforcement: guard in `executeSubtask()` that checks every file path against
the protected set before any write. Applies to both create and modify.

---

## ExecutionPermit

Before ExecutionAgent writes anything, it must receive an `ExecutionPermit`
generated from the approved plan:

```typescript
interface ExecutionPermit {
  issueNumber: number;
  planFingerprint: string;
  subtaskId: string;
  allowedFiles: string[];
  issuedAt: string;
}
```

The WorkflowCoordinator issues the permit when human approves the plan.
ExecutionAgent refuses to run without a valid permit.

This creates a three-layer chain:

```
Human approves plan
      ↓
WorkflowCoordinator issues permit
      ↓
ExecutionAgent executes (permit-scoped)
```

Even if ExecutionAgent is invoked directly outside the workflow, it cannot
operate without a permit that matches the plan it was given.

---

## Q2: What is a unit of execution?

**One subtask.** The agent never operates on an entire plan at once.

```
ExecutionPlan
  ├── step-0  →  ExecutionAgent runs step-0  →  evidence
  ├── step-1  →  ExecutionAgent runs step-1  →  evidence
  ├── step-2  →  ExecutionAgent runs step-2  →  evidence
  └── step-3  →  ExecutionAgent runs step-3  →  evidence
```

Each subtask gets its own:
1. Evidence record (`execution_subtask_started`)
2. Protected-path validation
3. File writes (restricted to `subtask.files`)
4. Test run (`npx vitest run <testFiles>`)
5. Commit (`git add <files> && git commit -m "<subtask>"`)
6. Evidence record (`execution_subtask_completed`)

If any subtask fails → stop. No auto-retry, no self-repair.

---

## Q3: What evidence is required?

The existing `execution_started` / `execution_completed` are too coarse.
Five new event types:

| Event | When | Payload keys |
|---|---|---|
| `execution_subtask_started` | Before subtask begins | issueNumber, subtaskId, files |
| `execution_subtask_completed` | After tests pass + commit | issueNumber, subtaskId, commitSha, filesChanged |
| `execution_test_passed` | Tests green | issueNumber, subtaskId, testFiles, durationMs |
| `execution_test_failed` | Tests red | issueNumber, subtaskId, testFiles, error |
| `execution_commit_created` | After `git commit` | issueNumber, subtaskId, commitSha, files |

---

## Q4: What is success?

A subtask is complete when ALL of the following are true:

1. **Files written** — all `subtask.files` exist on disk (or were modified)
2. **Protected paths respected** — no file touched a protected path
3. **Tests pass** — `npx vitest run <subtask.testFiles>` exits 0
4. **Commit created** — `git commit` with the subtask description
5. **Evidence written** — both `execution_subtask_started` and
   `execution_subtask_completed` exist in the evidence store

Not measured: lines of code, compile speed, diff size.

---

## Q5: Can it self-repair?

**No.** First version is strictly one-shot per subtask:

```
Subtask starts
  → write files
  → run tests
  → tests pass? → commit → next subtask
  → tests fail? → STOP → ReviewAgent reports → human decides
```

No autonomous retry loop. No auto-rollback. No fallback strategies.
Self-repair is deferred to P4.6 or P4.7.

---

## State machine

The existing transitions handle the ExecutionAgent flow:

```
APPROVED_FOR_EXECUTION → EXECUTING         (execution starts)
EXECUTING → BLOCKED                         (waiting on external)
BLOCKED → EXECUTING                         (unblocked)
EXECUTING → UNDER_REVIEW                    (code ready for review)
```

No new transitions needed. The ExecutionAgent transitions
`APPROVED_FOR_EXECUTION → EXECUTING` when it begins the first subtask.
After the last subtask completes, it transitions `EXECUTING → UNDER_REVIEW`.

---

## Subtask execution loop

```
for each subtask in plan.subtasks:
  1. record execution_subtask_started
  2. validate all files against protected paths
  3. if violation → STOP, record execution_aborted
  4. write/modify files in subtask.files
  5. run tests: npx vitest run subtask.testFiles
  6. if tests fail → STOP, record execution_test_failed
  7. if tests pass → record execution_test_passed
  8. git add + git commit
  9. record execution_commit_created
  10. record execution_subtask_completed

After all subtasks:
  11. transition EXECUTING → UNDER_REVIEW
  12. record execution_completed
```

---

## File structure

| File | Action |
|------|--------|
| `src/workflow/agents/execution-agent.ts` | CREATE |
| `tests/workflow/agents/execution-agent.vitest.ts` | CREATE |
| `src/security/evidence/evidence-types.ts` | MODIFY — 5 new event types |

---

## Acceptance criteria

- [ ] Only writes files in `subtask.files`
- [ ] Rejects protected path violations
- [ ] Executes one subtask at a time
- [ ] Records evidence per subtask (started/completed)
- [ ] Runs tests and records pass/fail evidence
- [ ] Creates git commits per subtask
- [ ] Stops on first failure
- [ ] Transitions `APPROVED_FOR_EXECUTION → EXECUTING → UNDER_REVIEW`
- [ ] No auto-repair, no retry loop

---

*End of addendum. Implementation begins when this document is reviewed.*
