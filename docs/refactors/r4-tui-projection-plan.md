# R4 — TUI / API Projection Convergence Plan

**Status:** R4 complete — R4.1–R4.7 landed; tag `r4-complete`. Remaining accepted debt: V2 (snapshot session source).
**Phase register:** R4 (after R3 complete, tags `r3-consolidation` / `r3-graph-executor-adapt` / `r3-complete`).
**Provenance:** R0 audit §4 (V-findings) re-verified against current HEAD in this session; R0 line numbers
had drifted, so this file records the verified current locations. Keep it current as sub-steps land.

## Contract (from the phase register)

Fix in order: V3 success-inference → V1 live-session painter reads → V5 approval dual truth →
V6 live evolution reads → V7 inferred workflow steps → V4 quarantine `runtime-snapshot.ts`/`store.ts`,
then legacy Inspector vocabulary. Workbench shows "unknown/awaiting canonical event", never infers;
one snapshot contract shared TUI + browser.

## Verified current state (recon)

| V | Current location | Still defective? | Importers | Tests |
|---|---|---|---|---|
| V1 | `src/tui/frame-painter.ts:242-250` (`getVersion/getSessionId/getMode` live reads), also `:200`, `:393` | NO — R4.2: header reads version/sessionId/mode only from the immutable snapshot (`snap.session`); live `AgentSession` reads removed and the painter dep deleted | `app.ts:30,195` (active legacy path) | `tests/tui/frame-painter-status-row.vitest.ts` |
| V2 | `src/tui/snapshot-builder.ts:68-76` ctor takes `session` + `runtime`; `:136` `session.getState()`, `:182-199` live session reads | ACCEPTED — session metadata is captured through `SnapshotBuilder` ports; runtime is EventLog-derived; liveness/activity have no EventLog source yet. Recorded as accepted debt until a session projection exists (presentation-only phase) | `cli/commands/tui.ts:9,375`; `app.ts:11`; `runtime/approval-projection-collector.ts:4` | `tests/tui/snapshot-builder.vitest.ts` pins both args |
| V3 | `src/tui/app.ts:710-728` legacy `a`/`d`: optimistic `pendingApprovals.shift()` + synthetic `resolvedApprovals.unshift()` + `resolve()` (default `recordLocally`) | NO — R4.1: legacy a/d mirrors Workbench (`pendingApprovalDecisions` guard, `resolve(..., {recordLocally:false})`, no optimistic shift/unshift) | `TuiApp` active | workbench tests pin clean path; legacy block now mirrors it |
| V4 | `src/tui/runtime-snapshot.ts:46` (`buildRuntimeSnapshot`) — **no `src/` importer**; `src/tui/store.ts` — type-only importers; `src/tui/index.ts:9-10` dead barrel | NO — R4.3 deleted `runtime-snapshot.ts`, `store.ts`, the empty `index.ts` barrel, their tests, and the 4 R4 allowlist entries | none | `tests/tui/trace-detail-panel.test.ts` (render-only, migrated), `tests/tui/ifamas-approval-context.test.ts` (local shape, migrated) |
| V5 | direct `ApprovalStore` read only in dead `src/tui/runtime-snapshot.ts:110-136`; active path is `runtime/approval-projection*.ts` (EventLog) | NO — R4.3 removed the dead direct read; the EventLog projection is the only path | — | `tests/tui/runtime/approval-projection*.vitest.ts` |
| V6 | `src/tui/runtime/evolution/evolution-projection.ts:159-203` reads live `capabilityService.platform` + `RecommendationStore` JSONL (`cli/commands/tui.ts:155-198`); only some events relayed | NO — R4.4 declared the four stages (`NON_EVENTLOG_AUTHORITATIVE_STAGES`) non-EventLog authoritative; no canonical emitter exists, so it is a declared read model, not an inference | small | `tests/tui/runtime/evolution-*.vitest.ts`, `tests/tui/views/evolution-view.vitest.ts` |
| V7 | `src/tui/runtime-collector.ts:380-436` `computeWorkflow`: boundaries canonical (`workflow.created/completed`), step counts HEURISTIC (`toolStartedCount`/`totalStepEvents`) | NO — R4.5 declared the tool/task step accounting a documented fallback (`WORKFLOW_STEP_FALLBACK_TYPES`); no canonical step emitter exists | `runtime-collector.ts:302` | `tests/tui/runtime/runtime-collector.vitest.ts` (new direct pins), `tests/tui/dashboard-renderer.vitest.ts:376-454`, `tests/tui/views/runtime-view.vitest.ts:67` |
| V10 | `src/ui/projection.js` + `src/inspector/projection.ts` legacy-only vocab (`tool.requested/completed`, `subagent.*`, `autonomy.scope_*`, `verification.check_*`); TUI timeline dual | NO — R4.6: browser reads canonical `context.bundle_compiled` and prefers canonical `agent.*` lifecycle (legacy `subagent.*` fallback); `VISIBLE_EVENTS` delivers canonical `agent.*`/`approval.*`. Verified `autonomy.scope_*`/`verification.check_*` are the emitted vocab for those concerns (no canonical alternative); canonical approvals already have their own API panel | ui `app.js`, inspector `session-reader.ts` | `tests/ui/projection.vitest.ts` (new running lane), `tests/inspector-projection.test.ts` |

## Sub-steps

| Step | Scope | Status |
|---|---|---|
| R4.0 | Persist this recon/plan | ✅ |
| R4.1 | V3: legacy `a`/`d` mirrors Workbench — guard `pendingApprovalDecisions`, `resolve(..., {recordLocally:false})`, no optimistic shift/unshift; card clears only from the authoritative resolved projection | ✅ |
| R4.2 | V1: `FramePainter` reads `version`/`sessionId`/`mode` only from the immutable snapshot (`snap.session`); live `AgentSession` reads removed (`:200,:242-250,:393`) and the `agentSession` painter dep deleted. `SessionMetadata.sessionId` added, captured once by `SnapshotBuilder` from `getSessionId()`. Pins: builder captures sessionId; painter header renders the snapshot id | ✅ |
| R4.3 | V5+V4: delete dead `src/tui/runtime-snapshot.ts` (+ its test) and the dead type barrel `src/tui/index.ts` re-exports; remove the 4 R4 allowlist entries in the same commit; migrate/remove value-test dependence on `store.ts`; then quarantine/delete `store.ts` once no value importers remain | ✅ |
| R4.4 | V6: evolution projection — either add canonical EventLog sources for lifecycle/forecasts/correlations/decisions or explicitly declare them non-EventLog authoritative (decide after checking emitter availability) | ✅ |
| R4.5 | V7: consume a canonical workflow step event for `currentStep`/`totalSteps`; keep tool counting only as a documented fallback (needs an emitter — verify first) | ✅ |
| R4.6 | V10: migrate `src/ui/projection.js` + `src/inspector/projection.ts` to the canonical vocab (or a shared projection port) so browser and TUI see one reality | ✅ |
| R4.7 | DOX (`src/tui/AGENTS.md` + `src/ui/AGENTS.md` + `src/inspector` if present) + full gates + `check:dox --base origin/main` + `detect_changes` + tag `r4-*` | ✅ |

### Notes / risks

- V2 (snapshot dual-source) is NOT in the register's fix order; document it as accepted until a session
  projection exists, or fold into R4.2 if the painter fix exposes it.
- V6/V7 fixes depend on emitters that may not exist yet (canonical evolution / workflow-step events).
  If an emitter is absent, the honest fix is a documented fallback + a DOX claim, not an inference.
- V10 may need to be split: server projection first (shared TS), then `src/ui/projection.js`.
- This is a presentation-only phase: no runtime authority changes.

---

# Resume here (fresh session)

**Branch:** `refactor/r2-ledger` · **HEAD:** tag `r4-complete` · worktree clean.
**Tags:** `r3-complete`, `r3-consolidation`, `r3-graph-executor-adapt`, `r4-complete` (rollback points).
**Gates green at R4 complete:** `pnpm test:node` 8489 pass / 0 fail · `pnpm test:vitest` 7145 pass / 0 fail · `npx tsc -p tsconfig.json --noEmit` · `npx tsc -p tsconfig.unused.json --noEmit` · `node scripts/check-dead-modules.mjs` · `node scripts/check-dox-claims.mjs --base origin/main`.

## First actions in the new session
1. Read this file, the root `AGENTS.md` (DOX rail + GitNexus rules), and `src/tui/AGENTS.md` before editing TUI.
2. `git log --oneline origin/main..HEAD` to re-anchor.
3. Run GitNexus `impact` before editing a symbol; `detect_changes` before every commit.

## R4.1 (V3) — ✅ done
Legacy `a`/`d` approval handling mirrors the Workbench: `pendingApprovalDecisions` guard, `resolve(..., {recordLocally:false})`, no optimistic shift/unshift; the card clears only from the authoritative resolved projection (`ab518661`).

## R4.2 (V1) — ✅ done
`FramePainter` reads `version`/`sessionId`/`mode` only from the immutable snapshot (`snap.session`); live `AgentSession` reads removed and the painter dep deleted; `SessionMetadata.sessionId` captured once by `SnapshotBuilder` (`c24c6c5c`).

## R4.3 (V5+V4) — ✅ done
1. Deleted `src/tui/runtime-snapshot.ts` (+ its test) and the empty `src/tui/index.ts` barrel (dropped its `check-dead` ENTRYPOINT).
2. Removed the 4 `removalPhase: R4` entries from `tests/architecture/r1-allowlist.json`; the shrink-only freeze test passes.
3. Deleted `src/tui/store.ts` and the store-only tests (`store`, `trace-panel`, `replays-panel`, `batch-commands`).
4. Migrated `tests/tui/trace-detail-panel.test.ts` to render-only and `tests/tui/ifamas-approval-context.test.ts` to a local approval shape — neither imports the deleted store.
5. DOX: added the "one TUI read model, no legacy store" contract bullet to `src/tui/AGENTS.md`.

## R4.4 (V6) — ✅ done
Emitter check: no canonical EventLog family exists for lifecycle/forecasts/correlations/decisions (only `capability.governance.proposal.*` + `...measurement.measured`). Declared the four stages non-EventLog authoritative rather than inventing inference.
1. Added `NON_EVENTLOG_AUTHORITATIVE_STAGES` + explicit module-docstring statement to `src/tui/runtime/evolution/evolution-projection.ts`.
2. Pinned the declaration in `tests/tui/runtime/evolution-projection.vitest.ts` (relay never feeds the declared stages).
3. Added a wiring-site comment in `src/cli/commands/tui.ts`.
4. DOX: added the "evolution-loop stages carry a declared source authority" bullet to `src/tui/AGENTS.md`.

## R4.5 (V7) — ✅ done
Emitter check: no canonical `workflow.step_*` event exists (only `workflow.created`/`workflow.completed`; the one `workflow.step_started` is a fabricated non-whitelisted type in a timeline test). Kept tool counting as a documented fallback rather than inventing steps.
1. Added `WORKFLOW_STEP_FALLBACK_TYPES` + strengthened the `computeWorkflow` docstring in `src/tui/runtime-collector.ts`; the counter now derives from that declared set.
2. Added direct `computeWorkflow` tests in `tests/tui/runtime/runtime-collector.vitest.ts` (fallback vocabulary + derivation + completion boundary).
3. DOX: added the "workflow step counts are a declared fallback" bullet to `src/tui/AGENTS.md`.

## R4.6 (V10) — ✅ done
Recon: the browser's real divergences were a dead `context.bundle_created` read (never emitted) and a `subagent.*`-only agent timeline, plus `VISIBLE_EVENTS` omitting canonical events. `autonomy.scope_*`/`verification.check_*` are the emitted vocab for those concerns (no canonical alternative), and canonical PolicyGate approvals already have their own `/api/approvals` panel — so a full approvals remap would conflate scope expansion with approvals.
1. `src/ui/projection.js`: `buildContext` reads canonical `context.bundle_compiled` (legacy `bundle_created` fallback); `projectSubagentEvents` prefers canonical `agent.*` lifecycle with legacy `subagent.*` fallback (no double projection on a dual-emitting runtime).
2. `src/inspector/projection.ts`: mirrors the canonical `agent.*` preference; widened `SubagentEvent.type`.
3. `src/server/server.ts`: `VISIBLE_EVENTS` now delivers canonical `agent.*` lifecycle + `approval.requested/resolved`.
4. `src/ui/app.js`: subagent timeline strips both `subagent.`/`agent.` prefixes.
5. Replaced the two inert `tests/ui/*.test.js` files (never compiled or run by any lane) with `tests/ui/projection.vitest.ts`, so the browser projection vocabulary actually runs in CI.
6. DOX: updated `src/ui/AGENTS.md` (ownership, canonical-vocabulary contract, verification).

## R4.7 — ✅ done
1. DOX sweep: `src/tui/AGENTS.md` (R4/V2 accepted-debt bullet; R4/V1, V3, V4–V5, V6, V7 already recorded), `src/ui/AGENTS.md` (R4/V10), `src/server/AGENTS.md` (`VISIBLE_EVENTS` canonical delivery).
2. Full gates: `pnpm test:node` 8489/0 · `pnpm test:vitest` 7145/0 · typecheck · unused · `check:dead` · `check:dox`.
3. `detect_changes` clean at risk LOW.
4. Tag `r4-complete` (rollback point). Accepted debt remaining: V2 (session projection).

## Next phase
R5 (tool-taxonomy unification) per `docs/refactors/r0-findings-r3-plan.md`.

## Mechanics
- Golden regen: `UPDATE_GOLDENS=1 npx vitest run tests/tui/workbench/parity-goldens.vitest.ts --config vitest.config.mts` (inspect the diff; only the intended text should change).
- Full gates after each step that touches code used by both lanes: `pnpm test:node` then `pnpm test:vitest`.
- Known flake: `tests/governance/governance-report.test.ts` CLI spawn-budget (see `docs/known-flakes.md`); solo re-run + repeat lane confirms.
- GitNexus index may lag a few commits (advisory); `node .gitnexus/run.cjs analyze --index-only` to refresh. FTS/BM25 was degraded on the last build (`Invalid UTF-8` in `Property.property_fts`) — `gitnexus analyze --repair-fts` if keyword search is needed; graph + embeddings are fine.
- DOX owner rule: root `AGENTS.md` requires an impact check before symbol edits and `detect_changes` before commits.
