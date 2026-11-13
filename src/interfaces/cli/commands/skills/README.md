# Skills CLI Commands

## Overview
`alix skills` operator surface. `run-skills.ts` maps argv to a `SkillsCommand` and dispatches to the install, run, marketplace, distill-from-traces, or help handler; each concern lives in its own module. Installation resolves a skill from the registered marketplace registry or from an explicit `--from` source, scans and gates it through the skill trust layer, and swaps it into the scoped store atomically. Skill scripts run through the Layer-4 sandbox rather than the agent shell. Network access is https-only and validated per redirect hop against the shared `alix_web_fetch` policy.

## Interface
- `SkillsCommand` is the closed dispatch union: `help`, `available`, `install`, `run`, `distill-from-traces`, `marketplace` `[run-skills.ts:SkillsCommand]`.
- `resolveSkillsCommand(args)` parses argv through the shared `parseSkillsArgs` and returns a `SkillsCommand`; `runSkillsCommand(args)` dispatches the result `[run-skills.ts:resolveSkillsCommand]` `[run-skills.ts:runSkillsCommand]`.
- `parseSkillsArgs(args)` splits flags, positionals, and the `--from` value in one pass; `resolveInstallOptions(args)` maps the same parse to `InstallOptions` `[install.ts:parseSkillsArgs]` `[install.ts:resolveInstallOptions]`.
- `InstallOptions` carries `list`, `available`, `refresh`, `remove`, `name`, `from`, `force`, `project`, and `global` `[install.ts:InstallOptions]`.
- `resolveScopeLabel(opts)` returns `project` or `global` and throws when both scope flags are set `[install.ts:resolveScopeLabel]`.
- `runInstall(opts, overrides?)` handles available, list, remove, `--from` install, marketplace-name install, and the default help path `[install.ts:runInstall]`.
- `atomicInstallSkill(targetDir, build)` installs through a temp sibling and a rename swap `[install.ts:atomicInstallSkill]`.
- `printSkillsHelp()` is the usage text listing every subcommand `[install.ts:printSkillsHelp]`.
- `resolveSkillScriptPath(skillDir, script)` resolves a bare script name into `<skillDir>/scripts/` `[run-skill.ts:resolveSkillScriptPath]`.
- `runSkillCommand(name, script, args, opts?)` resolves the installed skill directory and executes the script sandboxed `[run-skill.ts:runSkillCommand]`.
- `DEFAULT_MARKETPLACES` seeds `anthropics/skills` and `langfuse/skills`; `loadMarketplaces`, `addMarketplace`, and `removeMarketplace` manage the registry `[marketplace.ts:DEFAULT_MARKETPLACES]` `[marketplace.ts:loadMarketplaces]` `[marketplace.ts:addMarketplace]` `[marketplace.ts:removeMarketplace]`.
- `listRepoSkills` lists a repo's skills through the GitHub tree API with an on-disk cache; `listAvailableSkills` prints every registered marketplace and tolerates per-marketplace failures `[marketplace.ts:listRepoSkills]` `[marketplace.ts:listAvailableSkills]`.
- `runMarketplaceCommand(action, name?, url?, homeDir?)` dispatches `list`, `add`, and `remove` `[marketplace.ts:runMarketplaceCommand]`.
- `resolveSkillInMarketplaces` resolves a name to a single `SKILL.md`; `resolveSkillPackageInMarketplaces` and `fetchSkillPackage` resolve a full package `[marketplace.ts:resolveSkillInMarketplaces]` `[marketplace.ts:resolveSkillPackageInMarketplaces]` `[marketplace.ts:fetchSkillPackage]`.
- `parseGithubUrl`, `githubRawCandidates`, `fetchSkillFromUrls`, `fetchText`, and `fetchJson` are the GitHub URL shaping and fetch primitives `[net.ts:parseGithubUrl]` `[net.ts:githubRawCandidates]` `[net.ts:fetchSkillFromUrls]` `[net.ts:fetchText]` `[net.ts:fetchJson]`.
- `parseDistillArgs(args)` is pure usage parsing and `handleSkillsDistillFromTraces(args)` is the exiting handler `[distill-from-traces.ts:parseDistillArgs]` `[distill-from-traces.ts:handleSkillsDistillFromTraces]`.
- No child contract directories exist; every module is a top-level file.

## Invariants
- The first non-flag positional selects the subcommand; an unknown positional or an unknown marketplace action returns `{ type: "help" }` rather than throwing `[run-skills.ts:resolveSkillsCommand]` `[install.ts:parseSkillsArgs]`.
- Passing both `--project` and `--global` is a usage error in command resolution, install option resolution, scope-label resolution, and the run handler `[run-skills.ts:resolveSkillsCommand]` `[install.ts:resolveInstallOptions]` `[install.ts:resolveScopeLabel]` `[run-skill.ts:runSkillCommand]`.
- `run` locates the script token with a sequential scan; everything from the script token onward is passed raw to the script, so scope flags must precede the script name `[run-skills.ts:resolveSkillsCommand]`.
- `resolveSkillScriptPath` rejects an empty name, `.`, `..`, any `/` or `\`, and a leading `~`; only a bare filename inside `scripts/` can resolve `[run-skill.ts:resolveSkillScriptPath]`.
- `runSkillCommand` requires both a skill and a script, resolves `--project` to `<cwd>/.alix/skills`, and otherwise resolves across discovered roots `[run-skill.ts:runSkillCommand]`.
- `runSkillCommand` requires an installed `SKILL.md` and an existing script file before it launches the sandbox `[run-skill.ts:runSkillCommand]`.
- The install trust gate runs before file writes; a `deny` outcome throws instead of installing `[install.ts:runInstall]` `[install.ts:installFromSource]` `[install.ts:gateAndRecordInstall]`.
- `atomicInstallSkill` builds into a temp sibling, verifies `SKILL.md` exists, renames the existing target to a backup, swaps in the new directory, restores the backup if the swap fails, and removes the temp directory in `finally` `[install.ts:atomicInstallSkill]`.
- Installing a name whose scoped directory already contains `SKILL.md` short-circuits and never overwrites it `[install.ts:runInstall]`.
- A URL package install rejects a requested name that differs from the package manifest name, mirroring the local-directory name guard `[install.ts:installFromSource]` `[install.ts:resolveSkillDir]`.
- A local-directory source that resolves to the same real path as the install target is rejected as already installed `[install.ts:installFromSource]`.
- Remote sources reject plain `http://`; only `https://` is accepted `[install.ts:installFromSource]` `[net.ts:assertHttps]`.
- Every skill fetch validates its host through `validateNetworkHost` with an empty allowlist (public hosts only, private/loopback rejected), re-validates on each redirect, caps redirects at five, and caps payloads at 1MB with a 15s timeout `[net.ts:validateSkillHost]` `[net.ts:fetchValidated]` `[net.ts:fetchText]`.
- `fetchJson` always sends a `User-Agent: alix` header `[net.ts:fetchJson]`.
- `addMarketplace` requires a non-empty name, an `https:` URL, and a `github.com` host; duplicate names or normalized URLs return `{ added: false }` without persisting `[marketplace.ts:addMarketplace]`.
- `loadMarketplaces` seeds `DEFAULT_MARKETPLACES` when the registry is missing, unparseable, empty, or partially invalid `[marketplace.ts:loadMarketplaces]` `[marketplace.ts:seedDefaults]`.
- `listRepoSkills` serves a cached entry when the request limit is within the cached limit and the entry is younger than `MARKETPLACE_INDEX_TTL_MS` (1h), and serves a stale entry when a refetch fails `[marketplace.ts:listRepoSkills]` `[marketplace.ts:MARKETPLACE_INDEX_TTL_MS]`.
- A corrupt or wrong-shape marketplace index is ignored rather than thrown, and index writes are best-effort `[marketplace.ts:readMarketplaceIndex]` `[marketplace.ts:writeIndexEntry]`.
- `fetchSkillPackage` returns `null` before fetching any blob when the resolved skill directory has no `SKILL.md` blob, and throws when the package exceeds 20MB `[marketplace.ts:fetchSkillPackage]`.
- Package install excludes `net.ts` `EXCLUDED_DIRS`; marketplace listing uses its own separate listing exclusion set `[net.ts:EXCLUDED_DIRS]` `[marketplace.ts:EXCLUDED_DIRS]`.
- `parseDistillArgs` requires `--candidates` and converts `--min-runs`/`--min-score` only when finite, otherwise leaving them undefined `[distill-from-traces.ts:parseDistillArgs]`.
- `handleSkillsDistillFromTraces` tolerates a failed config load by falling back to flag/default factory settings, and exits 1 only when the factory is disabled `[distill-from-traces.ts:handleSkillsDistillFromTraces]`.

## Side Effects
- `runInstall` and `installFromSource` create the scoped skills directory (`~/.alix/skills` or `<cwd>/.alix/skills`) and write skill files there `[install.ts:runInstall]` `[install.ts:installFromSource]`.
- `atomicInstallSkill` renames the existing target to a backup, renames the temp directory into place, and removes the backup and temp directory `[install.ts:atomicInstallSkill]`.
- `gateAndRecordInstall` appends a `SkillInstallRecord` to `SkillInstallHistory` under `<skillsDir>/../security` for every gate decision `[install.ts:gateAndRecordInstall]`.
- Successful install and remove call `invalidateSlashCatalog()` `[install.ts:runInstall]` `[install.ts:installFromSource]` `[install.ts:removeSkill]`.
- `removeSkill` recursively deletes `<skillsDir>/<name>` after confirming `SKILL.md` exists `[install.ts:removeSkill]`.
- Marketplaces persist to `~/.alix/marketplaces.json`; the listing cache persists to `~/.alix/marketplace-index.json` `[marketplace.ts:marketplacesPath]` `[marketplace.ts:marketplaceIndexPath]` `[marketplace.ts:saveMarketplaces]` `[marketplace.ts:writeIndexEntry]`.
- Marketplace listing and package resolution fetch `api.github.com` trees and `raw.githubusercontent.com` blobs over the validated network path `[marketplace.ts:fetchRepoSkills]` `[marketplace.ts:fetchSkillPackage]` `[net.ts:fetchText]`.
- `runSkillCommand` executes the script through `runSandboxed` with `denyNetwork`, `requireNetworkIsolation`, and `sandboxTimeoutMs` from the safety config, writes captured stdout/stderr, emits a security warning when isolation was requested but not established, and sets `process.exitCode` from the sandbox result `[run-skill.ts:runSkillCommand]`.
- `handleSkillsDistillFromTraces` loads config, resolves a saved provider API key, creates a live provider, and calls `distillMinedCandidates`; it writes usage or factory errors to stderr and calls `process.exit(1)` `[distill-from-traces.ts:handleSkillsDistillFromTraces]`.
- All handlers report through `console.log`/`console.error`; `listAvailableSkills` catches a per-marketplace listing failure and continues to the next marketplace `[marketplace.ts:listAvailableSkills]` `[run-skills.ts:runSkillsCommand]`.

## Verification
- Run: `pnpm test`
