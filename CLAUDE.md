<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ALiX** (13613 symbols, 24598 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.
- NEVER push directly to `main`. Always create a feature branch, push it, open a PR, and merge via PR — never `git push origin main`. This ensures Greptile reviews every change and the Grep Loop can run.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ALiX/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ALiX/clusters` | All functional areas |
| `gitnexus://repo/ALiX/processes` | All execution flows |
| `gitnexus://repo/ALiX/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Agent skills

### Issue tracker

GitHub Issues — use `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. Read `CONTEXT.md` at repo root (if it exists) and `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

## Post-MVP Roadmap

Work deferred past MVP is tracked in `docs/post-mvp-backlog.md`. Key items in dependency order:

- **P0.1:** Context Compiler — ranked repo context bundle with intent classification
- **P0.2:** Provider edit format policy — per-model patch reliability defaults
- **P1.1:** Full frontend observability — diff viewer, approval panel, replay controls
- **P1.2:** Verification planner — test mapping, cost-based ordering, residual risk reporting
- **P2.1:** Extension registry — unified taxonomy for skills/hooks/recipes/plugins
- **P3.1:** Multi-agent coordination — read-only subagents first, ownership registry
- **P3.2:** Memory system — project/user/session/tool/repo memory layers

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## opensrc — Source Code Context

Key dependency source code is cached locally via opensrc and available as context.
The cache is symlinked into `.opensrc/repos` for project-local access.

Use `npx opensrc path <org/repo>` to get the absolute path, or reference opensrc
by name when asking about implementation details — the source code is available
locally and provides the ground truth for any API or framework.

Currently cached (all at `.opensrc/repos/` → `~/.opensrc/repos/`):
- `microsoft/typescript` — `.opensrc/repos/github.com/microsoft/typescript/main/`
- `facebook/react` — `.opensrc/repos/github.com/facebook/react/main/`
- `lukeed/ms` — `.opensrc/repos/github.com/lukeed/ms/master/`
- `pewdiepie-archdaemon/odysseus` — `.opensrc/repos/github.com/pewdiepie-archdaemon/odysseus/dev/`

Add more with: `npx opensrc fetch <org/repo>`
