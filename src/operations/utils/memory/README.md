# Agent Memory Store

## Overview
Markdown plus YAML-frontmatter persistence for agent memory. `MemoryStore` owns the on-disk layout, index, and daily logs; `recall.ts` builds retrieval and system-prompt context; `consolidate.ts` extracts decisions from recent logs, decays stale confidence, archives low-confidence entries, and rebuilds the index; `decision-extractor.ts` detects decisions from event payloads. The runtime contract is project-scoped under the store's configured base path, defaulting to `.alix/memory`.

## Interface
- `MemoryType` is the closed set `user`, `project`, `feedback`, `reference` `[types.ts:MemoryType]`.
- `MemoryEntry` carries name, description, type, content, timestamps, confidence, confirmations, and optional source `[types.ts:MemoryEntry]`.
- `MemoryConfig` and `DEFAULT_MEMORY_CONFIG` define decay, per-type limit, schedule, and index-size settings; defaults are enabled decay, 30 days, 50 entries, daily, and 100 lines `[types.ts:DEFAULT_MEMORY_CONFIG]`.
- `MemoryStore` exposes construction, `getBasePath`, `init`, `save`, `find`, `loadIndex`, `buildIndex`, and `logSession` `[store.ts:MemoryStore]`.
- `RecallLevel`, `RecallOptions`, and `RecallResult` define progressive recall; `recall(query, store, options)` returns entries and rendered context `[recall.ts:recall]`.
- `buildMemoryStats(store)` renders a confidence-sorted summary grouped by type; `buildMemoryContext(store)` renders the stored index as system-prompt context `[recall.ts:buildMemoryStats]` `[recall.ts:buildMemoryContext]`.
- `ConsolidateResult` reports extracted decisions plus archived and updated counts `[consolidate.ts:ConsolidateResult]`.
- `consolidate(store)` runs the sleep-cycle pass `[consolidate.ts:consolidate]`.
- `extractDecisions(content)` extracts decision strings from log text `[consolidate.ts:extractDecisions]`.
- `DECISION_PATTERNS`, `DecisionPattern`, `extractDecisions(events)`, and `promptDecisionConfirmation(decisions)` define event-based extraction and optional confirmation `[decision-extractor.ts:DECISION_PATTERNS]` `[decision-extractor.ts:extractDecisions]` `[decision-extractor.ts:promptDecisionConfirmation]`.
- `index.ts` re-exports the store, recall, consolidation, and canonical types `[index.ts:MemoryStore]`.
- No child contract directories exist.

## Invariants
- `init()` creates the base, four type directories, and `logs`, and writes `config.json` and `memory.md` only when each file is absent `[store.ts:MemoryStore.init]`.
- `save()` writes one Markdown file at `<basePath>/<type>/<sanitized-name>.md` and sets both `createdAt` and `modifiedAt` to the save time `[store.ts:MemoryStore.save]` `[store.ts:MemoryStore.sanitizeFilename]`.
- Filename sanitization lowercases, replaces non-alphanumeric runs with `-`, trims edge hyphens, and truncates to 50 characters `[store.ts:MemoryStore.sanitizeFilename]`.
- Saving an existing name and type overwrites that path; the method does not read or merge the prior entry `[store.ts:MemoryStore.save]`.
- `find()` scans the four type directories in fixed order, matches a case-insensitive substring across the entire file, and stops once the limit is reached `[store.ts:MemoryStore.find]`.
- `parseEntry()` requires leading YAML frontmatter delimited by `---` and defaults confidence to `0.5` and confirmations to `0` when parsing yields falsy values `[store.ts:MemoryStore.parseEntry]`.
- `logSession()` appends to `logs/YYYY-MM-DD.md` and creates that day's file with a heading when it does not exist `[store.ts:MemoryStore.logSession]`.
- `recall()` requests up to `limit * 2` candidates, applies optional type and minimum-confidence filters, sorts confidence descending, then slices to `limit` `[recall.ts:recall]`.
- Recall candidate `content` is empty because `recall.ts` parses only frontmatter into `MemoryEntry` `[recall.ts:parseEntry]`.
- Brief context shows names and confidence, standard context shows name, description, confidence, and the first 200 content characters, and detailed context shows type, confidence, confirmations, optional source, creation time, and full content `[recall.ts:buildContext]`.
- `buildMemoryContext()` returns `No memory entries found.` for an empty index and `No memories recorded.` when the index yields no sections or links `[recall.ts:buildMemoryContext]`.
- `consolidate()` decays entries older than 30 days with confidence below `0.9` by `0.1` per pass, never below zero `[consolidate.ts:consolidate]`.
- Consolidation archives an entry only after decay leaves confidence below `0.2`, moving it under `<basePath>/archived/` with a `<type>-<filename>` name `[consolidate.ts:consolidate]`.
- Consolidation reads only logs modified within the last seven days `[consolidate.ts:extractDecisionsFromLogs]`.
- Consolidation always rebuilds the index after processing `[consolidate.ts:consolidate]`.
- `decision-extractor.ts` scans only `user.message`, `agent.message`, `hook.pre_task`, and `hook.post_task` events, reading text, output, command, or reason in that precedence order `[decision-extractor.ts:isTextEvent]` `[decision-extractor.ts:extractText]`.
- Event extraction starts each new decision at confidence `0.5` with zero confirmations and a `session:<id>` source `[decision-extractor.ts:extractDecisions]`.
- Non-TTY confirmation accepts every decision at confidence `0.6`; an interactive `y` confirms at `0.6` with one confirmation, `n` skips, and `q` stops the loop `[decision-extractor.ts:promptDecisionConfirmation]`.

## Side Effects
- `MemoryStore.init` creates directories and may write `config.json` and `memory.md` `[store.ts:MemoryStore.init]`.
- `MemoryStore.save` writes an entry file and may insert a link into `memory.md` `[store.ts:MemoryStore.save]` `[store.ts:MemoryStore.updateIndex]`.
- `MemoryStore.buildIndex` rewrites `memory.md` `[store.ts:MemoryStore.buildIndex]`.
- `MemoryStore.logSession` appends to or creates a dated log file `[store.ts:MemoryStore.logSession]`.
- `consolidate` rewrites decayed entry files, creates `archived/`, renames archived entries, and rebuilds the index `[consolidate.ts:consolidate]`.
- `promptDecisionConfirmation` reads `process.stdin` and writes prompts to `process.stdout` through `readline` in a TTY `[decision-extractor.ts:promptDecisionConfirmation]` `[decision-extractor.ts:promptUser]`.

## Verification
- Run: `pnpm test`
