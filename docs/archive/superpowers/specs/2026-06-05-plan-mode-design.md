# `--plan` Mode Design

**Status:** ✅ Completed (M0.31) — Design implemented and committed to main.

**Goal:** Plan generation is the default flow for `alix run`. Before executing any task, the model generates a structured plan showing what it intends to do. The user approves, edits, or rejects the plan before any files are touched.

**Architecture:** A single new phase inserted between context compilation and the tool execution loop. The model generates a plan in plain markdown (no tools, pure reasoning), the user approves via a simple prompt, and the approved plan is injected into the execution system prompt as a shared commitment.

---

## 1. UX Summary

```
alix run "add healthz endpoint"

→ [context compilation]
→ [model generates plan — no tools, pure text]
→ prints:

  ## Plan: Add /healthz endpoint
  **Type:** feature | **Complexity:** low | **Risk:** low

  ### Changes
  1. **Create** `src/routes/health.ts`
     - GET handler returning `{ status: "ok" }`
  2. **Modify** `src/routes/index.ts`
     - Import and register route

  ### Verification
  - `npm run build` passes
  - `curl localhost:3000/healthz` returns 200

  ### Impact
  - No callers affected
  - No breaking changes

  Approve plan? [Y/n/e/d] _
```

**Key bindings:**
- **Y** — approve and execute (plan injected into execution system prompt)
- **n** — cancel ("Plan rejected. Task cancelled.")
- **e** — open `.alix/plans/<session>.md` in `$EDITOR`, user edits, saves → resumes from approval
- **d** — show expanded details per change

**Skipping plan mode:**
- `alix run "task" --no-plan` — skip plan generation, direct execution (current behavior)
- Tasks classified as "question" or "research" — if no file changes expected, auto-approve (print plan, skip prompt)
- `--session-mode bypass` — if user already opted into full autonomy, skip plan prompt

---

## 2. Flow

```
Current:  classify → context → tool loop → verify → repair

New:      classify → context → PLAN ──→ approve? ──→ tool loop → verify → repair
                                   │        │
                                   │   [n]  │
                                   │        ↓
                                   │    cancel
                                   │
                              [e] → $EDITOR → overwrite plan → approve
```

**Plan generation:**
- The model is called with the same context bundle but **no tools** (or only read-only tools like `file.read` if it needs to verify something)
- System prompt requests a structured plan in markdown with Changes, Verification, and Impact sections
- No YAML, no parsing — the plan is human-readable text

**Plan storage:**
- Saved to `.alix/plans/<session-id>.md` regardless of approval status
- If edited via `e`, the edited file replaces the original
- The plan file is part of the session record

**Plan injection:**
- On approval, the plan is prepended to the execution system prompt:
  ```
  ## Approved Plan
  You previously generated this plan and the user approved it.
  Follow this plan. If you discover something that makes the plan
  incorrect or incomplete, explain why before deviating.
  \n{plan_content}
  ```
- This anchors the model to its original reasoning but allows graceful deviation when new information surfaces during tool use

---

## 3. Implementation

### Files to create
- `src/run/plan-phase.ts` — new module: `generatePlan()` and `promptForPlanApproval()`

### Files to modify
- `src/agent/agent-loop.ts` — in `runTask()`, after context compilation, call `runPlanPhase()` before entering the tool loop
- `src/run.ts` — add `planMode?: boolean` to `RunOpts` (default true)
- `src/cli.ts` — add `--no-plan` flag parsing
- `src/task-classifier.ts` — ensure classifier exposes whether the task requires file changes (for auto-skip logic)

### `src/run/plan-phase.ts`

```typescript
export interface PlanPhaseResult {
  action: "approved" | "rejected" | "edited";
  planContent: string;
  planPath: string;
}

export async function runPlanPhase(
  ctx: AgentContext,
  bundle: ContextBundle,
  task: string
): Promise<PlanPhaseResult> {
  // 1. Build plan system prompt
  // 2. Call model with NO tools (just reasoning + text)
  // 3. Save plan to .alix/plans/<session-id>.md
  // 4. Print plan to stdout
  // 5. If read-only task → auto-approve
  // 6. Prompt [Y/n/e/d]
  // 7. Return result
}
```

### Plan system prompt

```
You are planning the implementation of the following task in this repository.
Do NOT execute anything yet. Generate a structured plan with:

1. Summary of what needs to be done
2. Type of work (feature/fix/refactor/research/docs)
3. List of file changes — for each: action (create/modify/delete), file path,
   and a brief description of the change
4. Verification steps — how to confirm the work is correct
5. Risk assessment — what could go wrong, what's the blast radius

Use this repository context:
{context_bundle}
```

### Approval prompt

```typescript
function promptForPlanApproval(): Promise<'yes' | 'no' | 'edit'> {
  // Read single keypress: Y/n/e/d
  // Y → 'yes'
  // n → 'no'
  // e → spawn $EDITOR on plan file, wait for close → 'edit'
  // d → show expanded detail, then re-prompt
}
```

### Edit flow
When `e` is pressed:
1. $EDITOR is resolved from `process.env.VISUAL ?? process.env.EDITOR ?? "vim"`
2. `child_process.spawnSync(editor, [planPath], { stdio: "inherit" })` — user edits
3. On editor exit, re-read the plan file, show it, and auto-approve (user already expressed intent by editing)
4. The edited plan is what gets injected

---

## 4. Edge Cases

| Case | Handling |
|------|----------|
| Read-only task (question, research) | Plan printed, auto-approved, no prompt |
| Plan generation fails (model error) | Fall back to direct execution with warning |
| User hits Ctrl+C during plan | Clean exit, plan file still saved |
| Edited plan is empty/malformed | Reject with "Empty plan, cancelled" |
| `--session-mode bypass` | Skip plan prompt, auto-approve |
| `--no-plan` flag | Skip entire plan phase |
| Device is headless (no TTY) | Auto-approve (plan still printed) |

---

## 5. Relationship to existing `alix plan` command

The existing `alix plan` command (YAML-based plan generator) is a standalone utility — it generates plans offline without executing. The new `--plan` mode is inline and replaces the need for `alix plan` for most use cases. Both can coexist: `alix plan` remains for CI/offline planning; `--plan` mode covers interactive use.

---

## 6. Testing

- Unit test `generatePlan()`: mock model response, assert plan file created with correct content
- Unit test `promptForPlanApproval()`: simulate each keypress (Y/n/e/d) and verify return value
- Integration: run `alix run "add healthz" --plan` in a test dir, assert plan printed and prompt appears
- Edge: `alix run "who is the president" --plan` — assert auto-approve (no file changes expected)
- Edge: `alix run "add healthz" --no-plan` — assert plan phase skipped entirely
