# Documentation Pass Design

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Source:** User-requested improvement — "documentation pass: getting started, examples"

## Motivation

ALiX has extensive internal architecture (12 providers, MCP, multi-agent, TUI, etc.) but limited user-facing documentation. The README is a brief overview. New users face a high barrier to entry because:

1. **No getting-started guide** — they have to infer install steps from README
2. **No feature tour** — capabilities are scattered across docs/ without examples
3. **No worked examples** — users don't know what kind of tasks ALiX can handle
4. **No config reference** — settings live in `.alix/config.json` but aren't documented

## Goals

1. **Getting-started guide** — install, configure provider, run first task in 5 minutes
2. **Features tour** — every capability with a working example
3. **Configuration reference** — complete config schema with CLI equivalents
4. **Worked examples** — 3 realistic tasks showing ALiX's behavior

## Non-Goals

- API reference (the public API is the CLI; that's already in --help)
- Architecture deep-dives (those live in `docs/architecture/`)
- Tutorial videos (no tooling for that)

## Architecture

All new files are markdown. No code changes.

### New Files

- `docs/getting-started.md` — step-by-step setup
- `docs/features.md` — feature tour with examples
- `docs/configuration.md` — config reference
- `examples/README.md` — examples index
- `examples/bug-fix.md` — fix a TS error
- `examples/add-feature.md` — add a new endpoint
- `examples/use-mcp.md` — use a GitHub MCP server

### Modified

- `README.md` — link to new docs

## Success Criteria (Achieved)

- [x] `docs/getting-started.md` (150+ lines)
- [x] `docs/features.md` (200+ lines)
- [x] `docs/configuration.md` (150+ lines)
- [x] `examples/` with 3 worked examples
- [x] README links to all new docs
- [x] Merged to main
