# src/skills — Skill Lifecycle (dispatch, distill, promote)

Purpose: installed-skill runtime — dispatch skill scripts, distill new
candidate skills from sessions or mined trace evidence, and promote
eligible candidates under usage gating.

## Ownership

| File | Responsibility |
|------|----------------|
| `factory.ts` | Distillation: `runSkillFactory` (session prose), `runSkillFactoryFromTrace` (trace evidence + candidate bar), `distillMinedCandidates` (mine `--factory-out` batches), prompt builders |
| `dispatcher.ts` | Post-session factory dispatch |
| `promotion.ts` | `promoteIfEligible` (success-gated install, versioning) |
| `types.ts` | `parseSkillContent` (front-matter manifest validation) |
| `discovery.ts` | Discovery roots + union loading (`getSkillDiscoveryRoots`, `loadDiscoveredSkillManifests`, `resolveDiscoveredSkillDir`); `loader.ts` stays single-root |
| `test-isolation.ts` | `stashChanges` / `restoreChanges` / `runWithIsolation` — git-stash isolation for verification commands, **guarded** (see contracts) |

## Local Contracts

- **Verification isolation is guarded, not default (durable).**
  `runWithIsolation` stashes the working tree so a verification command cannot
  pollute it. That is only sound when the command is not supposed to be looking
  AT that work. `stashChanges` therefore refuses any root that
  `isVerificationSandbox` rejects, and a refusal runs the command in place.
  The task loop passes the agent's real `cwd`, so post-change verification
  sees the edits it is verifying. A temp directory is NOT auto-trusted — this
  repo runs real agent work and real git repos there. Structural opt-ins: a
  directory named `verify-sandbox`, anything under `node_modules/`, or
  `ALIX_VERIFY_ISOLATION_ROOT` naming the RESOLVED root exactly (a parent path
  does not satisfy it). Marker matching is separator-agnostic (`split(/[\\/]+/)`,
  never the platform's `sep`): a `\`-separated path matched no marker on POSIX
  and a real sandbox silently lost isolation. `runCommand` uses the platform
  interpreter (`ComSpec` on Windows, `/bin/sh` elsewhere) — a hardcoded POSIX
  shell made every Windows verification fail as a spawn error, reported as
  `failed` and indistinguishable from the command genuinely failing. Contract
  violation to report, not to work around: a verification that stashes the tree
  it is verifying passes for code nobody wrote. Both path shapes are pinned in
  `tests/skills/verification-isolation-guard.vitest.ts` so the Windows and
  POSIX lanes assert one table.

- **Discovery roots (durable):** read paths (slash catalog, agent/session
  catalogs, `run` route detection, `skills run` resolution) union
  `<cwd>/.alix/skills` (first, when a project dir is known) >
  `~/.alix/skills` > read-only `~/.agents/skills`. First root wins on
  `manifest.name` collision. Management pins scope explicitly:
  `alix skills install/remove/list/run` default (and `--global`) to the
  user store; `--project` selects `<cwd>/.alix/skills` (`--project` +
  `--global` is a usage error; `run` scope flags must precede the script
  name). Promotion and eviction stay user-store-only: the factory never
  writes the project store, and the project store is never auto-evicted.

- **Candidate bar** (plan tunables, enforced factory-side): ≥ 5 unique
  traceIds sharing a tool-sequence shape, every traced run scoring ≥ 0.8.
  Identity is unique traceIds (run counters can inflate); per-trace
  `scores` are mandatory — scoreless evidence is rejected, never distilled
  on count alone.
- **Fire-and-forget:** `runSkillFactoryFromTrace` never throws into the
  caller (provider may be down); it reports `{accepted, reason}` so batch
  callers can summarize. (`runSkillFactory` stays `void` — only the trace
  variant reports.) `distillMinedCandidates` additionally isolates
  per-row failures (including malformed JSONL) — one bad row never aborts
  the batch. A missing batch file itself throws (caller usage error).
- **Write target:** candidates land in `~/.alix/candidates/<sessionId>/`
  (`mined` for trace-evidence batches), never the workspace.
- **Mine→factory chain:** `mine.mjs --factory-out` emits `MinedCandidate`
  rows (tool sequence + traceIds + runs + scores + sessions);
  `alix skills distill-from-traces` distills them with the configured
  factory provider. Sessions ride as prompt provenance (`traceSessions`),
  not identity.

## Work Guidance

- New distillation inputs go through the candidate bar in
  `runSkillFactoryFromTrace` — never gate caller-side.
- Keep `MinedCandidate` a `Pick` of `TraceEvidence` so the mine/factory
  contract cannot drift field by field.
- Skill tests must isolate HOME to a temp dir (see `promotion.test.ts`):
  cleanup hooks that run against the real `~/.alix` will delete the
  operator's installed skills on every test run.

## Verification

```bash
pnpm build  # typecheck + build (must be green)
node --test dist/tests/skills/factory-trace.test.js
```

## Child DOX Index

None.
