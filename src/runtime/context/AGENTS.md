# DOX — Runtime Context Builder (State-aware Prompt)

**Purpose:** Bounded, state-aware prompt assembly — P + Σ + O + E + Tools with tiered budgeting and history opt-in. The mechanical layer that turns an immutable skill, a compact ExecutionState projection, a latest observation, bounded evidence, and allowed tools into a constant-size prompt for the LLM.

**Ownership:**
- `context-builder.ts` — `buildExecutionContext(skill, state, observation, evidence, tools)` pure mechanical builder; `renderExecutionState` compact `<execution_state>` (not raw JSON), `renderObservation` hard-capped 2k tokens (~8k chars, large output → concise + evidence ref), `renderEvidence` bounded top-K 5-10 / 4k tokens (~16k chars, score-sorted), `renderTools` from capabilities+constraints (prompt/tool surface agree), `renderSkill` capped, `toCandidateItems` maps to `src/config/context-assembly.ts` 6-tier categories (state → `current_execution_state` protected P1 / Tier-3, tools → `mandatory_system_governance`, skill → `current_task`, observation → `recent_tool_results`, evidence → `recent_conversation`, history → `older_context` opt-in only).
- `retrieval.ts` — `ContextRetrieval` production retrieval via real EventLog file indexes (`.alix/sessions/<executionId>/events.jsonl`) and StateProjector checkpoints (`ExecutionStateStore`); indexes by executionId / evidenceId / historySlice (seq / range), plus checkpoint/ExecutionState via store+projector; file-authoritative with mtime-guarded cache, read-only deterministic fail-closed; `src/runtime/retrieval.ts` barrel re-exports for `src/runtime/retrieval` import path (tracer #640).

**Local Contracts:**
- Pure, no side effects, no I/O, no token budgeting — single `countTokens` ownership stays with `src/config/context-assembly.ts` / `src/config/context-budget.ts` (state protected P1, deterministic overflow, single final accounting).
- Prompt bounded `O(|P|+|Σ|+|O|)` constant for 10 or 500 steps: skill capped, state sub-lists capped (pending/artifacts/constraints/capabilities ≤20), observation hard-capped 2k tokens, evidence hard-capped top-K/4k tokens, history never included unless explicitly passed.
- ExecutionState rendering is compact XML-like, not raw `state.json` JSON; `null` vs omission semantics respected by not rendering absent fields as JSON nulls.
- Large observation → truncated preview + evidence-reference marker; evidence beyond top-K and char budget tail-dropped (lowest-score first) with `dropped` count.
- Tools filtered against `ExecutionState.constraints` (`deny_tool`/`blocked_capability`/`blocked_tool` suppression) so prompt and tool surface agree.
- History opt-in only — `opts.history` absent → no `<history>` section; EventLog remains authoritative behind the projector.
- Deterministic ordering: evidence score-desc when scores present, else source order; skill/observation/evidence truncation preserves determinism.
- Retrieval — real file indexes only (`.alix/sessions/*/events.jsonl` + `ExecutionStateStore` checkpoint); by executionId is file-scoped (sessionDir basename), by evidenceId scans `evidence.observation` payload, by historySlice is seq exact/range; StateProjector checkpoint via store+`project` rebuild (INV-P7, INV-10); cached with mtime guard for per-decision speed but file-authoritative (invalidate on append).

**Work Guidance:**
- Do NOT add store/projector/governor logic here — only the builder (issue #630 constraint).
- To change caps, update `MAX_OBSERVATION_CHARS` / `MAX_EVIDENCE_CHARS` / `MAX_EVIDENCE_ITEMS` and keep char≈token*4 heuristic documented.
- To add a new tier, map it in `toCandidateItems` and verify `assembleContext` tier ordering/eviction in `src/config/context-assembly.ts` (protected vs best-effort) still holds.
- Adding a new skill shape should extend `SkillInput` and `toSkillBody` without breaking the `buildExecutionContext` 5-arg mechanical signature.

**Verification:**
- `pnpm build && pnpm typecheck` — types compile, `dist/src/runtime/context/context-builder.js` + `dist/src/runtime/context/retrieval.js` emitted.
- Manual smoke: `renderExecutionState` contains `<execution_state>` not raw JSON; `renderObservation` truncates >8k chars with evidence-ref and `truncated=true`; `renderEvidence` admits ≤10, drops remainder, sorts by score, caps ~16k chars; `renderTools` suppresses `deny_tool` constrained tools; `buildExecutionContext` prompt bounded (500 pending → capped 20, diff <2k chars), history absent by default, `toCandidateItems` maps state → `current_execution_state` protected and `assembleContext` keeps state under budget pressure.
- Retrieval smoke: `ContextRetrieval` file indexes — `getEvidenceByIdSync('ev-...')` + `getHistorySliceSync(seq)` + `getEventsByExecutionIdSync(id)` + `getCheckpointSync(id)` all read real `.alix/sessions/events.jsonl` and `ExecutionStateStore` (not scenario stub); `RealEventLogEnvironment` delegates to `retrieval` (`hasRealEventLogFile` + cache prime); D hybrid via real indexes still `retrieval_precision 1.0, unnecessary 0` (`tests/benchmark-real-eventlog.vitest.ts` + manual `runHorizonsReal` bounded 10→500).

**Child DOX Index:**
- (none)
