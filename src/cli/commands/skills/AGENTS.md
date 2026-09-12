# src/cli/commands/skills — `alix skills` CLI Surface

Purpose: the `alix skills` command — list/install/run marketplace skills
and distill mined trace candidates into candidate skills.

## Ownership

| File | Responsibility |
|------|----------------|
| `run-skills.ts` | `resolveSkillsCommand` (args → command) + `runSkillsCommand` dispatch |
| `distill-from-traces.ts` | `alix skills distill-from-traces --candidates <file>` (P3 loop closure over `distillMinedCandidates`); pure `parseDistillArgs` (throws usage) kept testable apart from the exiting handler |
| `install.ts` | Install/remove + `printSkillsHelp` (lists every subcommand) |
| `run-skill.ts` | `alix skills run` sandboxed script execution + script-path resolution |
| `marketplace.ts` | Marketplace registry commands |

## Local Contracts

- **Routing:** first non-flag positional selects the subcommand; unknown
  subcommands (or bad marketplace actions) route to help, never stack
  traces. Flag-heavy subcommands receive raw args and parse via the
  shared `parseKeyValueArgs` (`src/cli/helpers/parse-args.ts`).
- **Help is the contract:** adding a subcommand means adding its
  `printSkillsHelp` line in the same change.
- **Operator context:** distill/eval commands run nightly/operator-gated
  with write creds or local files — never in the hot loop.

## Work Guidance

- New subcommands take raw post-subcommand args and parse them with the
  shared `parseKeyValueArgs`; keep usage-throwing pure parsing apart from
  the exiting handler so it stays unit-testable.

## Verification

```bash
pnpm build  # typecheck + build (must be green)
node --test dist/tests/cli/commands/skills/run-skills.test.js dist/tests/cli/commands/skills/distill-from-traces.test.js
```

## Child DOX Index

None.
