<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ALiX** (17062 symbols, 31180 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

# DOX — Durable Operating Contract

DOX is a hierarchical AGENTS.md framework. Every agent must follow DOX instructions across any edit.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read the root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index.
- Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a doc is to the work, the more specific and practical it must be.

## Child Doc Shape

Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.

Default section order:

1. **Purpose** — what this subsystem does
2. **Ownership** — key files and their responsibilities
3. **Local Contracts** — conventions, invariants, design decisions
4. **Work Guidance** — how to work in this area
5. **Verification** — how to test changes
6. **Child DOX Index** — list of child AGENTS.md files

## Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

## Closeout

- Re-check changed paths against the DOX chain.
- Update nearest owning docs and any affected parents or children.
- Refresh every affected Child DOX Index.
- Remove stale or contradictory text.
- Run existing verification when relevant.
- Report any docs intentionally left unchanged and why.

## User Preferences

- When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.
- Prefer subagent-driven development with two-stage review (spec compliance → code quality).
- Keep Inspector read-only; do not add POST endpoints for execution.
- CLI-first for all approval and audit actions.
- Commit early, push often; tag baseline milestones.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/kernel/AGENTS.md` | Graph execution engine — TaskGraph, GraphExecutor, projection, planner |
| `src/policy/AGENTS.md` | Policy rules, RuleEvaluator, RuntimeGate, default policies, loader |
| `src/registry/AGENTS.md` | Agent/tool cards, CardRegistry, CapabilityResolver, card loader |
| `src/approvals/AGENTS.md` | Approval queue, ApprovalStore |
| `src/audit/AGENTS.md` | Audit trail — JSONL append-only store |
| `src/server/AGENTS.md` | Inspector HTTP server, session reader, API routes |
| `src/ui/AGENTS.md` | Inspector web UI — HTML, JS, CSS, projection |
| `src/daemon/AGENTS.md` | Runtime daemon — manager, socket server, task registry, protocol |
| `src/runtime/AGENTS.md` | RuntimeIndex — on-demand aggregation across all backends |
| `docs/superpowers/AGENTS.md` | Implementation specs and plans |
