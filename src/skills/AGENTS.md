# src/skills — Skill Lifecycle (dispatch, distill, promote)

## Purpose

Installed-skill runtime — dispatch skill scripts, distill new
candidate skills from sessions or mined trace evidence, and promote
eligible candidates under usage gating.

## Ownership

| File | Responsibility |
|------|----------------|
| `factory.ts` | Distillation: `runSkillFactory` (session prose), `runSkillFactoryFromTrace` (trace evidence + candidate bar), `distillMinedCandidates` (mine `--factory-out` batches), prompt builders |
| `dispatcher.ts` | Post-session factory dispatch |
| `promotion.ts` | `promoteIfEligible` (success-gated install, collision/duplicate gates, versioning) |
| `types.ts` | `parseSkillContent` (front-matter manifest validation) |
| `discovery.ts` | Discovery roots + union loading (`getSkillDiscoveryRoots`, `loadDiscoveredSkillManifests`, `resolveDiscoveredSkillDir`); `loader.ts` stays single-root |
| `test-isolation.ts` | `stashChanges` / `restoreChanges` / `runWithIsolation` — git-stash isolation for verification commands, **guarded** (see contracts) |

## Local Contracts

- Promotion blocks shared-trigger and overlapping-pattern/text collisions with installed user-store skills, returning a reason. Same-name near-duplicate bodies are blocked before versioning; revised bodies retain version handling. `src/skills/pollution.ts` owns pure overlap scoring and duplicate detection.
- **Verification isolation is guarded, not default.**
  `runWithIsolation` stashes the working tree so a verification command cannot
  pollute an explicit sandbox. `stashChanges` refuses any root that
  `isVerificationSandbox` rejects, and a refusal runs the command in place.
  The task loop passes the agent's real `cwd`, so post-change verification
  sees the edits it is verifying. Temporary directories alone are not opt-ins.
  The complete opt-in list is a directory named `verify-sandbox`, a
  `node_modules/` subtree, an `.alix/verify/` subtree, or
  `ALIX_VERIFY_ISOLATION_ROOT` matching the resolved root exactly (not its
  parent). Match markers across both slash styles. `runCommand` uses `ComSpec`
  on Windows and `/bin/sh` elsewhere. Report any isolation that hides the
  edits being verified as a contract violation. Both path shapes are pinned in
  `tests/skills/verification-isolation-guard.vitest.ts` so the Windows and
  POSIX lanes assert one table.
- **Discovery roots:** read paths (slash catalog, agent/session
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
