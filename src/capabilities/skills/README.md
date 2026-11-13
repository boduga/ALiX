# Skills Runtime

## Overview

The skills runtime discovers and loads `SKILL.md` packages, assesses install trust, scans package files for denied content and dangerous script patterns, resolves slash commands, runs scripts in a bounded sandbox, and distills or promotes new candidate skills. Verification isolation is a separate guarded utility for stash-based command runs.

## Interface

- Skill data contracts and front-matter parsing: `SkillManifest`, `LoadedSkill`, `SkillCandidate`, `parseFrontMatter`, and `parseSkillContent` `[types.ts:parseSkillContent]`.
- Filesystem discovery and first-root deduplication: `getSkillDiscoveryRoots`, `loadSkillManifestsFromRoots`, `loadDiscoveredSkillManifests`, and `resolveDiscoveredSkillDir` `[discovery.ts:loadDiscoveredSkillManifests]`.
- Single-root loading: `loadSkillManifests`, `loadSkillContent`, and `loadSkills` `[loader.ts:loadSkills]`.
- Install trust assessment and gating: `assessTrust`, `decideInstall`, `renderInstallReport`, and `createInstallGate` `[trust.ts:createInstallGate]`.
- Manifest checks and package scanning: `checkManifest`, `scanSkillFiles`, `scanSkillDirectory`, and `DANGEROUS_SHELL_PATTERNS` `[security.ts:scanSkillDirectory]`.
- Safety configuration defaults: `loadSafetyConfig` and `LoadedSkillSafetyConfig` `[safety-config.ts:loadSafetyConfig]`.
- Sandboxed execution: `runSandboxed`, `SandboxRunOptions`, and `SandboxRunResult` `[sandbox.ts:runSandboxed]`.
- Catalog lookup and lazy body loading: `SkillCatalog` and `buildSkillCatalog` `[catalog.ts:SkillCatalog]`.
- Slash parsing, ranking, resolution, and canonical identity: `parseSlashInput`, `rankSkillMatches`, `resolveSkillName`, and `canonicalSkillId` `[slash.ts:rankSkillMatches]`.
- Generation-based slash manifest cache: `getSlashCatalog`, `invalidateSlashCatalog`, and `setSlashCatalogProjectDir` `[slash-catalog.ts:getSlashCatalog]`.
- Post-session and trace-based distillation: `runSkillFactory`, `runSkillFactoryFromTrace`, `distillMinedCandidates`, and `buildTraceDistillationPrompt` `[factory.ts:runSkillFactoryFromTrace]`.
- Promotion eligibility and collision naming: `promoteIfEligible` and `resolveNamingCollision` `[promotion.ts:promoteIfEligible]`.
- Catalog pollution scoring and duplicate-body detection: `detectCatalogPollution`, `findCandidateCollisions`, and `isDuplicateBody` `[pollution.ts:detectCatalogPollution]`.
- Store eviction: `evictIfNeeded` and `LifecycleConfig` `[lifecycle.ts:evictIfNeeded]`.
- Verification isolation: `isVerificationSandbox`, `stashChanges`, `restoreChanges`, and `runWithIsolation` `[test-isolation.ts:runWithIsolation]`.
- Post-session dispatch: `skillFactoryProcess` and `DEFAULT_FACTORY_CONFIG` `[dispatcher.ts:skillFactoryProcess]`.

## Invariants

- Discovery order is project `.alix/skills`, then `~/.alix/skills`, then `~/.agents/skills`; the first manifest name wins `[discovery.ts:getSkillDiscoveryRoots]` `[discovery.ts:loadSkillManifestsFromRoots]`.
- A missing or unreadable root yields an empty list; a missing or unreadable `SKILL.md` and invalid front matter are skipped rather than thrown `[loader.ts:loadSkillManifests]`.
- Front matter requires non-empty `name` and `description`; manifests containing control characters outside tab, LF, and CR are rejected `[types.ts:parseFrontMatter]`.
- Install decisions deny scan errors and manifest denials before trust handling, approve core skills, honor `--force`, and deny non-interactive non-core installs when confirmation is required `[trust.ts:decideInstall]`.
- Package deny findings are `error` severity and drive `ok`; shell-heuristic findings are always `warning` and can be suppressed only by their stable pattern code `[security.ts:scanSkillFiles]` `[security.ts:DANGEROUS_SHELL_PATTERNS]`.
- A single scanned file larger than 1 MB is skipped by the directory walker `[security.ts:MAX_SCAN_BYTES]`.
- Slash ranking order is exact trigger, exact name, trigger prefix, name prefix, then name subsequence; ties preserve input order `[slash.ts:rankSkillMatches]`.
- `canonicalSkillId` returns `manifest.name` and is the sole identity authority for catalog deduplication `[slash.ts:canonicalSkillId]`.
- The slash catalog caches one build per generation, serializes concurrent builds, and discards a result whose build generation changed `[slash-catalog.ts:getSlashCatalog]`.
- Trace distillation accepts only a non-empty tool sequence, at least five unique trace IDs by default, and mandatory per-trace scores meeting 0.8 by default `[factory.ts:runSkillFactoryFromTrace]`.
- One malformed or failing mined row is reported and does not abort the remaining batch `[factory.ts:distillMinedCandidates]`.
- Promotion increments usage before checking eligibility; promotion requires a success count of at least two `[promotion.ts:promoteIfEligible]`.
- Promotion blocks shared-trigger or overlapping-pattern collisions and same-name near-duplicate bodies before versioned installation `[promotion.ts:promoteIfEligible]` `[pollution.ts:findCandidateCollisions]`.
- An occupied name is reused only for a strictly higher version; otherwise the target receives a `-v<major>-<minor>-<patch>` suffix `[promotion.ts:resolveNamingCollision]`.
- Eviction preserves core skills and removes oldest non-core entries until the store count is at most `maxStore` `[lifecycle.ts:evictIfNeeded]`.
- Sandbox defaults are 30 seconds and a 1 MB capture cap; network isolation is attempted with `unshare -Un` on Linux and a missing namespace is reported through `networkIsolationFailed` `[sandbox.ts:DEFAULT_TIMEOUT_MS]` `[sandbox.ts:runSandboxed]`.
- Verification isolation refuses any root not recognized as an explicit verification sandbox and therefore runs the command in place on refusal `[test-isolation.ts:stashChanges]` `[test-isolation.ts:runWithIsolation]`.

## Side Effects

- Distillation writes the generated skill to `~/.alix/candidates/<sessionId>/SKILL.md` and may invoke promotion `[factory.ts:distillWithProvider]`.
- Promotion creates the installed skill directory, writes `SKILL.md`, and rewrites `.usage.json` in the user skills store `[promotion.ts:promoteIfEligible]`.
- Eviction recursively deletes eligible skill directories from the user skills store `[lifecycle.ts:evictIfNeeded]`.
- Sandboxed execution spawns a child process, creates a temporary directory for `HOME` and `TMPDIR`, and removes that directory after the run `[sandbox.ts:runSandboxed]`.
- The interactive install gate prints the install report and reads a confirmation from standard input `[trust.ts:defaultPrompt]`.
- Directory scanning reads file contents recursively while excluding configured directory names `[security.ts:scanSkillDirectory]`.
- Verification isolation runs `git stash push` and restores with `git stash pop --index` when a stash was created `[test-isolation.ts:stashChanges]` `[test-isolation.ts:restoreChanges]`.
- The post-session dispatcher launches the factory without awaiting it and logs asynchronous failures `[dispatcher.ts:skillFactoryProcess]`.

## Verification

- Run: `pnpm test`
