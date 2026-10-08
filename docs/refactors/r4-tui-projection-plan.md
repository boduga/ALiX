# R4 — TUI / API Projection Convergence Plan

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
| V1 | `src/tui/frame-painter.ts:242-250` (`getVersion/getSessionId/getMode` live reads), also `:200`, `:393` | YES — header prefers live `AgentSession` over the supplied snapshot (snapshot only a fallback) | `app.ts:30,195` (active legacy path) | `tests/tui/frame-painter-status-row.vitest.ts` pins the row, not live-vs-snapshot precedence |
| V2 | `src/tui/snapshot-builder.ts:68-76` ctor takes `session` + `runtime`; `:136` `session.getState()`, `:182-199` live session reads | PARTIAL — session metadata live; runtime EventLog-derived; liveness/activity have no EventLog source | `cli/commands/tui.ts:9,375`; `app.ts:11`; `runtime/approval-projection-collector.ts:4` | `tests/tui/snapshot-builder.vitest.ts` pins both args |
| V3 | `src/tui/app.ts:710-728` legacy `a`/`d`: optimistic `pendingApprovals.shift()` + synthetic `resolvedApprovals.unshift()` + `resolve()` (default `recordLocally`) | YES on legacy path. Workbench `:984-997` is clean (`recordLocally:false`, leaves projection untouched) | `TuiApp` active | workbench tests pin clean path; legacy optimistic block untested |
| V4 | `src/tui/runtime-snapshot.ts:46` (`buildRuntimeSnapshot`) — **no `src/` importer**; `src/tui/store.ts` — type-only importers; `src/tui/index.ts:9-10` dead barrel | NO — R4.3 deleted `runtime-snapshot.ts`, `store.ts`, the empty `index.ts` barrel, their tests, and the 4 R4 allowlist entries | none | `tests/tui/trace-detail-panel.test.ts` (render-only, migrated), `tests/tui/ifamas-approval-context.test.ts` (local shape, migrated) |
| V5 | direct `ApprovalStore` read only in dead `src/tui/runtime-snapshot.ts:110-136`; active path is `runtime/approval-projection*.ts` (EventLog) | NO — R4.3 removed the dead direct read; the EventLog projection is the only path | — | `tests/tui/runtime/approval-projection*.vitest.ts` |
| V6 | `src/tui/runtime/evolution/evolution-projection.ts:159-203` reads live `capabilityService.platform` + `RecommendationStore` JSONL (`cli/commands/tui.ts:155-198`); only some events relayed | PARTIAL (intentional Q-C3a) | small | `tests/tui/runtime/evolution-*.vitest.ts`, `tests/tui/views/evolution-view.vitest.ts` |
| V7 | `src/tui/runtime-collector.ts:380-436` `computeWorkflow`: boundaries canonical (`workflow.created/completed`), step counts HEURISTIC (`toolStartedCount`/`totalStepEvents`) | PARTIAL | `runtime-collector.ts:302` | `tests/tui/dashboard-renderer.vitest.ts:376-454`, `tests/tui/views/runtime-view.vitest.ts:67` |
| V10 | `src/ui/projection.js` + `src/inspector/projection.ts` legacy-only vocab (`tool.requested/completed`, `subagent.*`, `autonomy.scope_*`, `verification.check_*`); TUI timeline dual | YES | ui `app.js`, inspector `session-reader.ts` | `tests/ui/projection.test.js`, `tests/ui-projection.test.js`, `tests/inspector-projection.test.ts` |

## Sub-steps

| Step | Scope | Status |
|---|---|---|
| R4.0 | Persist this recon/plan | ✅ |
| R4.1 | V3: legacy `a`/`d` mirrors Workbench — guard `pendingApprovalDecisions`, `resolve(..., {recordLocally:false})`, no optimistic shift/unshift; card clears only from the authoritative resolved projection | ⬜ |
| R4.2 | V1: `FramePainter` reads `version`/`sessionId`/`mode` only from the immutable snapshot (`snap.session`); live `AgentSession` reads removed (`:200,:242-250,:393`) and the `agentSession` painter dep deleted. `SessionMetadata.sessionId` added, captured once by `SnapshotBuilder` from `getSessionId()`. Pins: builder captures sessionId; painter header renders the snapshot id | ✅ |
| R4.3 | V5+V4: delete dead `src/tui/runtime-snapshot.ts` (+ its test) and the dead type barrel `src/tui/index.ts` re-exports; remove the 4 R4 allowlist entries in the same commit; migrate/remove value-test dependence on `store.ts`; then quarantine/delete `store.ts` once no value importers remain | ✅ |
| R4.4 | V6: evolution projection — either add canonical EventLog sources for lifecycle/forecasts/correlations/decisions or explicitly declare them non-EventLog authoritative (decide after checking emitter availability) | ⬜ |
| R4.5 | V7: consume a canonical workflow step event for `currentStep`/`totalSteps`; keep tool counting only as a documented fallback (needs an emitter — verify first) | ⬜ |
| R4.6 | V10: migrate `src/ui/projection.js` + `src/inspector/projection.ts` to the canonical vocab (or a shared projection port) so browser and TUI see one reality | ⬜ |
| R4.7 | DOX (`src/tui/AGENTS.md` + `src/ui/AGENTS.md` + `src/inspector` if present) + full gates + `check:dox --base origin/main` + `detect_changes` + tag `r4-*` | ⬜ |

### Notes / risks

- V2 (snapshot dual-source) is NOT in the register's fix order; document it as accepted until a session
  projection exists, or fold into R4.2 if the painter fix exposes it.
- V6/V7 fixes depend on emitters that may not exist yet (canonical evolution / workflow-step events).
  If an emitter is absent, the honest fix is a documented fallback + a DOX claim, not an inference.
- V10 may need to be split: server projection first (shared TS), then `src/ui/projection.js`.
- This is a presentation-only phase: no runtime authority changes.

---

# Resume here (fresh session)

**Branch:** `refactor/r2-ledger` · **HEAD:** `6c650e84` (R4.3) · worktree clean · 36 commits ahead of `origin/main`.
**Tags:** `r3-complete`, `r3-consolidation`, `r3-graph-executor-adapt` (rollback points).
**Gates green after R4.3:** `pnpm test:node` (only the known `governance-report` spawn-budget flake — passes solo) · `pnpm test:vitest` 7133 pass / 0 fail · `npx tsc -p tsconfig.json --noEmit` · `npx tsc -p tsconfig.unused.json --noEmit` · `node scripts/check-dead-modules.mjs` · `node scripts/check-dox-claims.mjs --base origin/main`.

## First actions in the new session
1. Read this file, the root `AGENTS.md` (DOX rail + GitNexus rules), and `src/tui/AGENTS.md` before editing TUI.
2. `git log --oneline origin/main..HEAD` to re-anchor.
3. Run GitNexus `impact` before editing a symbol; `detect_changes` before every commit.

## R4.3 (V5+V4) — ✅ done
1. Deleted `src/tui/runtime-snapshot.ts` (+ its test) and the empty `src/tui/index.ts` barrel (dropped its `check-dead` ENTRYPOINT).
2. Removed the 4 `removalPhase: R4` entries from `tests/architecture/r1-allowlist.json`; the shrink-only freeze test passes.
3. Deleted `src/tui/store.ts` and the store-only tests (`store`, `trace-panel`, `replays-panel`, `batch-commands`).
4. Migrated `tests/tui/trace-detail-panel.test.ts` to render-only and `tests/tui/ifamas-approval-context.test.ts` to a local approval shape — neither imports the deleted store.
5. DOX: added the "one TUI read model, no legacy store" contract bullet to `src/tui/AGENTS.md`.

## R4.4–R4.7
- **R4.4 (V6):** `src/tui/runtime/evolution/evolution-projection.ts:159-203` reads live `capabilityService.platform` + `RecommendationStore` JSONL (`cli/commands/tui.ts:155-198`). First check whether canonical evolution/decision emitters exist; if not, the honest fix is an explicit non-EventLog declaration + DOX claim, not an inference. Update `tests/tui/runtime/evolution-*` + `tests/tui/views/evolution-view.vitest.ts`.
- **R4.5 (V7):** `computeWorkflow` (`src/tui/runtime-collector.ts:380-436`) infers step counts from tool/task events. Check for a `workflow.step_started` emitter first (only a test fabricates one today); if absent, keep tool counting as a documented fallback. Pins: `tests/tui/dashboard-renderer.vitest.ts:376-454`, `tests/tui/views/runtime-view.vitest.ts:67`.
- **R4.6 (V10):** `src/ui/projection.js` + `src/inspector/projection.ts` are legacy-only (`tool.requested/completed`, `subagent.*`, `autonomy.scope_*`, `verification.check_*`). Migrate to the canonical vocab / shared projection; tests `tests/ui/projection.test.js`, `tests/ui-projection.test.js`, `tests/inspector-projection.test.ts`.
- **R4.7:** DOX (`src/tui/AGENTS.md`, `src/ui/AGENTS.md`, plus `src/server` if inspector routes change) + full gates + `check:dox --base origin/main` + `detect_changes` + tag `r4-*`.

## Mechanics
- Golden regen: `UPDATE_GOLDENS=1 npx vitest run tests/tui/workbench/parity-goldens.vitest.ts --config vitest.config.mts` (inspect the diff; only the intended text should change).
- Full gates after each step that touches code used by both lanes: `pnpm test:node` then `pnpm test:vitest`.
- Known flake: `tests/governance/governance-report.test.ts` CLI spawn-budget (see `docs/known-flakes.md`); solo re-run + repeat lane confirms.
- GitNexus index may lag a few commits (advisory); `node .gitnexus/run.cjs analyze --index-only` to refresh. FTS/BM25 was degraded on the last build (`Invalid UTF-8` in `Property.property_fts`) — `gitnexus analyze --repair-fts` if keyword search is needed; graph + embeddings are fine.
- DOX owner rule: root `AGENTS.md` requires an impact check before symbol edits and `detect_changes` before commits.
