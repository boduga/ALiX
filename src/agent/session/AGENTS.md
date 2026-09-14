# DOX — Agent session

**Purpose:** `AgentSession` — the shared session engine for `run`, `run --chat`,
and the TUI. Extracted from the former `../session.ts` megafile (#717);
`../session.ts` is now a re-export barrel so existing import paths are unchanged.

**Ownership:**
- `types.ts` — `SessionPhase`, `Message`, `ToolExecution`, `AgentTurnResult`,
  `ToolResult`, `AgentSessionEvents`, `AgentSessionState`, `AgentSessionConfig`,
  `PlanConfig`, `ChatConfig`, `PersistenceConfig`, `EventConfig`, `ToolConfig`,
  and the `AgentSession` interface.
- `helpers.ts` — `readVersionCached` / `walkForPackageJson`, `livenessEventType`,
  `isCancellationError`, `buildSessionStreamHandler`, `emitSessionEvents`,
  `extractToolResultsFromMessages`.
- `setup.ts` — module-level `setup*` helpers (session/workflow/resume/memory/
  skills/context/plan/tools/system-prompt/hooks), `resolveExplicitSkills`,
  `buildSkillsSection`, `spliceSkillsSection`, `spliceExplicitIntoFirstTurn`,
  `createAgentSession`.
- `main.ts` — the `AgentSessionBuilder` class (incl. `build()`).

**Local Contracts:**
- `../session.ts` re-exports the public surface via `export *`; do not add logic
  there.
- **Pending (#717 5b):** `AgentSessionBuilder.build()` is a closure factory
  (~1,900 lines, ~24 nested functions over shared `let` state, incl.
  `processTurnBody` ~936 lines). It is not yet decomposed; `main.ts` is
  therefore still above the 1,500-line threshold. Decomposition must hoist the
  shared state into an explicit object and extract the nested functions into
  factories — it is a refactor, not a verbatim move. See the step 5 inventory
  in `docs/refactors/717-megafile-split-plan.md`.
- Relative imports: `../../` → `src/`, `../` → `src/agent/`.
- Source-scan sentinels that used to read `agent/session.ts` now read
  `agent/session/main.ts` (e.g. `tests/agent/session-skills.test.ts`,
  `tests/tracing/langfuse-boundary.vitest.ts`).

**Verification:**
- `tests/agent/*.vitest.ts`, `tests/agent/session-skills.test.ts`,
  `tests/session-resume.vitest.ts`, `tests/tracing/langfuse-boundary.vitest.ts`.
