# DO-NOT-DELETE

This folder archives **completed specs and plans** that should not be deleted.

## Structure

- **`plans-completed/`** — 71 plan files from earlier work (2026-05-12 through 2026-05-23)
- **`specs-2026-05-31/`** — 10 design specs from the 2026-05-31 batch
- **`plans-2026-05-31/`** — 10 implementation plans from the 2026-05-31 batch

## 2026-05-31 Batch

**Sub-Projects (Pi Agent learnings):**
1. `pi-llm-api-abstraction` — Unified LLM API (12 providers → spec modules)
2. `agent-runtime-split` — Decompose run.ts (452 lines → 5 focused modules)
3. `tui-differential-render` — Line-level diff (no flicker)
4. `supply-chain-hardening` — Pin deps, .npmrc, verify:deps
5. `self-extensibility` — 3 new tools (create_skill, list_extensions, inspect_extension)
6. ~~`public-session-sharing`~~ — Skipped per user

**Improvements:**
7. `tui-polish` — Layout constants, spinner phases, color budget bar
8. `mcp-improvements` — Error format, retry, server registry
9. `documentation` — Getting-started, features, config, examples
10. `performance` — Lazy imports, context cache, benchmark
11. `test-coverage` — 73 new tests for 10 undertested modules

**Total: 10 specs + 10 plans, all marked COMPLETED.**

## Why Archived?

- These documents represent design intent and implementation steps for shipped work
- They are useful for: understanding past decisions, training new contributors, citing rationale
- The `plans/` and `specs/` directories are kept lean for in-flight work only

Do not delete files in this folder.
