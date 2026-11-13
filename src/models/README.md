# Model Profiles & Routing Diagnostics

## Overview
Top-level model-management surface: hardware/profile compatibility diagnosis, profile ranking, profile installation/application against the project config, and a read-only description of the configured routing chain. These modules are orchestration helpers over `src/operations/config` — they do not implement provider transports; provider implementations live in `providers/` and tracing lives in `tracing/`.

## Interface
- Doctor report vocabulary: `DoctorSection`, `DoctorIssue`, `ProfileCompatEntry`, and `DoctorReport` [model-doctor.ts:DoctorReport].
- `runDoctor(system, _config, profiles, activeProfileId?)`: builds the hardware/runtime/provider sections, per-profile compatibility, and an actionable `nextStep` [model-doctor.ts:runDoctor].
- Ranking vocabulary: `FitRanking` and `FitOptions` (`role`, `mode`) [model-fit.ts:FitRanking].
- `rankProfiles(system, profiles, options)`: scores and sorts profiles by hardware fit, role bias, embeddings, and fallbacks [model-fit.ts:rankProfiles].
- `ROLE_BIAS`: per-role local/cloud score weights [model-fit.ts:ROLE_BIAS].
- Install/apply vocabulary: `ApplyResult` and `InstallResult` [model-install.ts:ApplyResult], [model-install.ts:InstallResult].
- `listAllProfiles()` and `showProfileDetail(id)`: profile registry passthroughs [model-install.ts:listAllProfiles], [model-install.ts:showProfileDetail].
- `applyProfile(profileId, cwd, dryRun?)`: patches and optionally persists the project config [model-install.ts:applyProfile].
- `installProfile(profileId, cwd, dryRun?)`: pulls missing Ollama models and applies the profile [model-install.ts:installProfile].
- `RoutingChainEntry` and `describeRoutingChain(config)`: primary plus fallback routing chain description [routing-cli.ts:describeRoutingChain].
- `providers/` — provider implementations, resolver, catalog, and registry [./providers/README.md](./providers/README.md) [providers/registry.ts:createProvider].
- `tracing/` — trace clients and capture: [./tracing/README.md](./tracing/README.md) [tracing/client.ts:TraceClient].

## Invariants
- `runDoctor` always emits the Hardware and Local Runtime sections; the API Providers section appears only when `system.apiProviders` has entries [model-doctor.ts:runDoctor].
- Doctor warnings are appended for undetected RAM, a configured provider missing its key, and an incompatible active profile; absent Ollama yields an `info` issue [model-doctor.ts:runDoctor].
- Doctor `nextStep` is set only when at least one issue exists, and is the literal `Run: alix models fit` [model-doctor.ts:runDoctor].
- `_config` is accepted but unused by `runDoctor`; the report is derived from `system`, `profiles`, and `activeProfileId` [model-doctor.ts:runDoctor].
- An incompatible profile is scored `0` with status `not recommended` and compatibility `incompatible`, and takes no role bias [model-fit.ts:rankProfiles].
- Compatible profiles receive `+10`, partial profiles `+5`, plus the role's local or cloud bias; embeddings add `+1` and enabled fallbacks add `+1` [model-fit.ts:rankProfiles], [model-fit.ts:ROLE_BIAS].
- The status projection is deterministic: compatible → `best fit`, partial → `alternative`, incompatible → `not recommended` [model-fit.ts:rankProfiles].
- `rankProfiles` returns a copy sorted by rank descending [model-fit.ts:rankProfiles].
- When `options.mode` is supplied it is an exact filter; profiles of other modes are skipped entirely [model-fit.ts:rankProfiles].
- `readConfig` requires `<cwd>/.alix/config.json` and throws instructing `alix init` when it is absent [model-install.ts:readConfig].
- `applyProfile` returns an `unknown profile` failure result rather than throwing for an unregistered id [model-install.ts:applyProfile].
- A dry run reports the computed patch and preserved sections but never writes the config [model-install.ts:applyProfile].
- `installProfile` skips the Ollama path for `mode === "cloud-only"` and applies the profile directly [model-install.ts:installProfile].
- A failed `ollama list` probe is swallowed and treated as no installed models; per-model pull failures are collected into `errors` [model-install.ts:installProfile].
- `installProfile` succeeds only when the apply step succeeded and no pull errors were collected [model-install.ts:installProfile].
- `describeRoutingChain` puts the resolver-required model first with role `primary`, then appends `buildFallbackChain` entries with role `fallback` [routing-cli.ts:describeRoutingChain].

## Side Effects
- `applyProfile` writes `<cwd>/.alix/config.json` via `writeConfig` unless `dryRun` is true [model-install.ts:applyProfile].
- `installProfile` spawns child processes: `ollama list` (5s timeout) and `ollama pull <model>` (300s timeout) [model-install.ts:installProfile].
- `readConfig` performs synchronous filesystem reads and existence checks [model-install.ts:readConfig].
- `describeRoutingChain` can throw when `createModelResolver(config).require()` finds no required model [routing-cli.ts:describeRoutingChain].
- `rankProfiles` and `runDoctor` perform no I/O; both are pure over their arguments [model-fit.ts:rankProfiles], [model-doctor.ts:runDoctor].

## Verification
- Run: `pnpm test`
