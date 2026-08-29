# src/utils/memory — Agent Memory Store (M2)

Purpose: the M2 memory subsystem — persistence of agent memory entries (Markdown + YAML frontmatter), recall/context builders for the system prompt, and consolidation/decision-extraction.

## Ownership

| File | Responsibility |
|------|----------------|
| `types.ts` | Canonical `MemoryType`, `MemoryEntry`, `MemoryConfig`, `DEFAULT_MEMORY_CONFIG` |
| `store.ts` | `MemoryStore`: init, save, find, index build/load, logSession over Markdown + YAML frontmatter |
| `recall.ts` | `recall()` progressive retrieval, `buildMemoryContext`, `buildMemoryStats` (system-prompt context) |
| `consolidate.ts` | "Sleep cycle" consolidation: decision extraction from logs, confidence decay, archiving, index rebuild |
| `decision-extractor.ts` | Event-based `extractDecisions(AlixEvent[])` + `promptDecisionConfirmation` |
| `index.ts` | Barrel re-exports (currently imported by nothing) |

## Local Contracts

- **Types (canonical):** `MemoryType = "user" | "project" | "feedback" | "reference"`. `MemoryEntry { name, description, type, content, createdAt, modifiedAt, confidence (0–1), confirmations, source? }`. `MemoryConfig` and `DEFAULT_MEMORY_CONFIG` (decayDays 30, maxEntriesPerType 50, consolidateSchedule daily, indexMaxLines 100).
- **Persistence:** one `.md` file per entry with YAML frontmatter, under `<basePath>/<type>/<sanitized-name>.md`; plus `<basePath>/memory.md` index and `<basePath>/logs/YYYY-MM-DD.md` session logs. Runtime base path is `<cwd>/.alix/memory/` (project-scoped — there is **no** global/user store despite the `"user"` MemoryType).
- **Identity / overwrite:** `save()` overwrites by `name+type` filename collision — no duplicate creation, but it is a plain overwrite, not a confirmed upsert.
- **Recall:** retrieval is substring match + confidence-descending sort, then level sizing (`brief`/`standard`/`detailed`). No semantic ranking.
- Config is **constructor-injected**; `.alix/memory/config.json` is written by `init()` but never read back.

## Work Guidance

- The runtime contract lives in `src/runtime/contracts/memory-contract.ts` (M1.6: `MemoryQuery`, `MemoryStoreContract`, `MEMORY_INVARIANTS`). Keep it a pure type contract — no runtime code.
- **The concrete `MemoryStore` does NOT structurally implement `MemoryStoreContract`:** it only provides `save` and `find`; `read`, `query`, `delete`, `list`, `consolidate` are declared in the contract but not on the class. Wire them if the full contract is ever exercised, and reconcile the "confidence monotonic" invariant against `consolidate()`'s decay (confidence is **decremented** 0.1/pass on old low-confidence entries).
- Runtime prompt usage (agent/session/agent-loop resume, session digest) uses `buildMemoryContext`/`buildMemoryStats` directly; `recall()`, `consolidate()`, `MemoryStore.logSession`, and the `index.ts` barrel have no runtime callers (tests only).
- `extractDecisions` appears in **two** unrelated implementations: `consolidate.ts` (raw log lines) and `decision-extractor.ts` (`AlixEvent[]`). Do not cross-use them.
- The frontmatter parser is copy-pasted in `store.ts`, `recall.ts`, `consolidate.ts` (recall's returns `content: ""`). Prefer consolidating into one if you touch it.
- Memory is persisted during `completeSession` via `saveDecisionsToMemory` (`src/run/helpers.ts`), try/catch-wrapped — memory failures must never break a session.

## Verification

- `tests/utils/memory/`: store, recall, types, cli, decision-extractor, session-integration.
- `tests/memory/decision-extractor.test.ts` is a divergent duplicate of `tests/utils/memory/decision-extractor.test.ts` — reconcile if touching.
- `tests/alix-capabilities.test.ts:490` asserts `src/memory/` exists but the real path is `src/utils/memory/` (stale).
- `tests/runtime/memory-contract.test.ts` asserts source↔contract parity.
- Full suite: `pnpm test:node` and `pnpm test:vitest`.

## Child DOX Index

None — `src/utils/memory/` is a leaf subsystem with no child AGENTS.md.
