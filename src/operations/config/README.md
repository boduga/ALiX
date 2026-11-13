# Configuration Runtime

## Overview

Owns the config lifecycle: locating and merging user and project config, normalizing the canonical `models` object and its compatibility projections, validating the merged result, resolving model descriptors and context budgets, loading hardware profiles and reliability data, tracking performance budgets, and persisting mutations through an atomic provenance-tracked writer with optional Ed25519 signing and trust evaluation. Every reader in this tree treats `models` as the single persistent source of model truth and treats `model` plus the `subagents.<tier>` keys as loader-derived projections.

## Interface

- `AlixConfig` and `PersistedAlixConfig` are the runtime and on-disk config types; `parseSessionMode`, `MODEL_CAPABILITY_NAMES`, `DISCOVERY_CAPABILITY_NAMES`, `MODEL_TIER_VALUES`, `MODEL_SUBAGENT_TIERS`, `isModelTier`, `isValidModelConfig`, and `seedLegacyModelDefault` are the schema helpers `[schema.ts:AlixConfig]`, `[schema.ts:PersistedAlixConfig]`, `[schema.ts:parseSessionMode]`, `[schema.ts:MODEL_CAPABILITY_NAMES]`, `[schema.ts:DISCOVERY_CAPABILITY_NAMES]`, `[schema.ts:MODEL_TIER_VALUES]`, `[schema.ts:MODEL_SUBAGENT_TIERS]`, `[schema.ts:isModelTier]`, `[schema.ts:isValidModelConfig]`, `[schema.ts:seedLegacyModelDefault]`.
- `DEFAULT_CONFIG` is the full defaulted config and `PERMIT_ALL_CONFIG` is the permissive variant `[defaults.ts:DEFAULT_CONFIG]`, `[defaults.ts:PERMIT_ALL_CONFIG]`.
- `projectConfigDir(cwd)` returns `<cwd>/.alix` and `userConfigDir()` returns `<homedir>/.config/alix`; `resolveUserConfigPath()` is the single `~/.config/alix/config.json` resolver with a test override seam `[loader.ts:projectConfigDir]`, `[loader.ts:userConfigDir]`, `[user-config-path.ts:resolveUserConfigPath]`, `[user-config-path.ts:_setUserConfigPathOverride]`.
- `loadConfig(cwd, options)` reads user then project config, resolves credentials, normalizes models, validates, and optionally evaluates trust; `normalizeModelConfig` and `mergeConfig` are the projection and deep-merge primitives `[loader.ts:loadConfig]`, `[loader.ts:normalizeModelConfig]`, `[loader.ts:mergeConfig]`.
- `createModelResolver(config)` exposes `resolve`/`require` over the canonical `models` object, and `NO_MODEL_CONFIGURED_MESSAGE` is the missing-model error text `[model-resolver.ts:createModelResolver]`, `[model-resolver.ts:NO_MODEL_CONFIGURED_MESSAGE]`.
- `isSubagentsEnabled` and `getSubagentRole` read only behavior config, never model selection `[subagent-config.ts:isSubagentsEnabled]`, `[subagent-config.ts:getSubagentRole]`.
- `getSearchConfig()` resolves the web-search provider from the user config `[search-config.ts:getSearchConfig]`.
- `validateConfig` returns issues and `isLoopbackHost` / `isValidHttpUrl` are its URL helpers `[validator.ts:validateConfig]`, `[validator.ts:isLoopbackHost]`, `[validator.ts:isValidHttpUrl]`.
- `ConfigMutationService` implements `read`, `set`, `delete`, and `getVersion`, `computeConfigHash` is the canonical hash, and `MUTATION_ERROR_CODES` is the stable error-code set `[mutation.ts:ConfigMutationService]`, `[mutation.ts:computeConfigHash]`, `[mutation.ts:MUTATION_ERROR_CODES]`.
- `withoutDerivedModelProjections` is the single projection-stripping boundary and `writeConfig` is the shared serializer `[persistence.ts:withoutDerivedModelProjections]`, `[persistence.ts:writeConfig]`.
- `buildProfilePatch`, `applyProfilePatch`, and `PRESERVED_SECTIONS` map a profile onto model assignments without touching other sections `[profile-patch.ts:buildProfilePatch]`, `[profile-patch.ts:applyProfilePatch]`, `[profile-patch.ts:PRESERVED_SECTIONS]`.
- `loadProfiles`, `listProfiles`, `getProfile`, `matchHardware`, and `resetProfileCache` expose the built-in profile registry `[profile-registry.ts:loadProfiles]`, `[profile-registry.ts:listProfiles]`, `[profile-registry.ts:getProfile]`, `[profile-registry.ts:matchHardware]`, `[profile-registry.ts:resetProfileCache]`; `PROFILE_TIER_MAP` and `validateProfile` are the tier mapping and loader guard `[profile-types.ts:PROFILE_TIER_MAP]`, `[profile-types.ts:validateProfile]`.
- `ReliabilityMatrix` loads `reliability-matrix.json` and answers edit-format, tool-call, and latency reliability questions `[reliability-matrix.ts:ReliabilityMatrix]`.
- `SAFETY_FACTOR`, `resolveModelDescriptor`, `clearModelDescriptorCache`, and `getEncoding` resolve context windows and tokenizers `[context-limits.ts:SAFETY_FACTOR]`, `[context-limits.ts:resolveModelDescriptor]`, `[context-limits.ts:clearModelDescriptorCache]`, `[context-limits.ts:getEncoding]`.
- `createContextBudget`, `preflight`, `classifyOverflow`, `ContextBudgetOverflowError`, and `assertFits` implement the context budget gate over `CONTEXT_CATEGORIES`, `MANDATORY_CATEGORIES`, and the output defaults `[context-budget.ts:createContextBudget]`, `[context-budget.ts:preflight]`, `[context-budget.ts:classifyOverflow]`, `[context-budget.ts:ContextBudgetOverflowError]`, `[context-budget.ts:assertFits]`, `[context-budget.ts:CONTEXT_CATEGORIES]`, `[context-budget.ts:MANDATORY_CATEGORIES]`, `[context-budget.ts:DEFAULT_OUTPUT_RATIO]`.
- `assembleContext` and `getContextAssemblyTelemetry` perform deterministic priority-first assembly `[context-assembly.ts:assembleContext]`, `[context-assembly.ts:getContextAssemblyTelemetry]`.
- `calibrationStorePath`, `loadCalibration`, `saveCalibration`, `deriveCalibrationFactor`, `getCalibrationFactor`, and `CALIBRATION_CLAMP` own the calibration store `[calibration-store.ts:calibrationStorePath]`, `[calibration-store.ts:loadCalibration]`, `[calibration-store.ts:saveCalibration]`, `[calibration-store.ts:deriveCalibrationFactor]`, `[calibration-store.ts:getCalibrationFactor]`, `[calibration-store.ts:CALIBRATION_CLAMP]`.
- `checkBudget`, `checkAllBudgets`, and `PERFORMANCE_BUDGETS` evaluate latency measurements `[performance-budgets.ts:checkBudget]`, `[performance-budgets.ts:checkAllBudgets]`, `[performance-budgets.ts:PERFORMANCE_BUDGETS]`.
- `detectSystem(config?)` probes OS, CPU, RAM, GPU, Ollama, and API providers `[hardware-detect.ts:detectSystem]`.
- `scopeToolsByTask`, `CORE_TOOL_NAMES`, `SCOPING_REASONS`, and `ScopingProvenance` implement deterministic tool scoping `[tool-scoping.ts:scopeToolsByTask]`, `[tool-scoping.ts:CORE_TOOL_NAMES]`, `[tool-scoping.ts:SCOPING_REASONS]`, `[tool-scoping.ts:ScopingProvenance]`.
- `ConfigSigner`, `SIGNING_ERROR_CODES`, `ConfigSignature`, and `TrustReport` implement Ed25519 signing and trust evaluation `[signing.ts:ConfigSigner]`, `[signing.ts:SIGNING_ERROR_CODES]`, `[signing.ts:ConfigSignature]`, `[signing.ts:TrustReport]`.
- `profiles/` holds the built-in profile JSON files; it has no child contract of its own.

## Invariants

- The user config path is `<homedir>/.config/alix/config.json` and never consults environment variables `[user-config-path.ts:resolveUserConfigPath]`.
- `loadConfig` merges `DEFAULT_CONFIG` with user then project config, so project values override user values `[loader.ts:loadConfig]`.
- An unresolved `cred://` API-key reference throws; an unavailable credential store also throws `[loader.ts:loadConfig]`.
- Resolved provider keys are injected into `process.env` only when the target variable is currently unset `[loader.ts:loadConfig]`.
- Tracing credential resolution is gated on `tracing.enabled === true` and fails open with a warning when the store is unavailable `[loader.ts:resolveTracingCredentials]`.
- `loadConfig` throws when no model resolves unless `requireModel: false` is passed `[loader.ts:loadConfig]`.
- Validation issues are emitted as warnings/errors and do not by themselves abort a normal load `[loader.ts:loadConfig]`.
- Trust evidence recording is best-effort, but an untrusted config in production mode throws `[loader.ts:loadConfig]`.
- `mergeConfig` deep-merges `model`, `permissions.tools`, `context`, `runtime`, `ui.security`, both `tracing` sub-blocks, all `decision` sub-blocks, `mcpServers`, and `models`; protected paths and MCP server paths are merged as unique unions `[loader.ts:mergeConfig]`.
- `modelTiers` overrides write into canonical `models.<tier>`, and env tier overrides apply last within each override pass `[loader.ts:mergeConfig]`.
- `createModelResolver.resolve` returns a defensive copy, an absent or `"default"` tier resolves `models.default`, and an explicit tier falls back to `models.default` when absent `[model-resolver.ts:createModelResolver]`.
- `createModelResolver.require` throws `NO_MODEL_CONFIGURED_MESSAGE` when no valid model resolves `[model-resolver.ts:createModelResolver]`.
- `validateConfig` checks a section only when it is present, so a missing section is incomplete rather than invalid; `valid` requires zero error-level issues `[validator.ts:validateConfig]`.
- `isLoopbackHost` accepts only `127.0.0.1`, `localhost`, `::1`, and `[::1]` `[validator.ts:isLoopbackHost]`.
- `computeConfigHash` serializes with sorted keys and hashes the result with SHA-256 `[mutation.ts:computeConfigHash]`.
- `ConfigMutationService.read` records the read hash for the next concurrency check `[mutation.ts:ConfigMutationService]`.
- `ConfigMutationService.set` and `delete` reject any `model.*` path, the whole `subagents` root, and every `subagents.*` key except `enabled` and `roles` leaves `[mutation.ts:assertMutableModelPath]`.
- `set` rejects secret-looking values with `SECRET_IN_PROJECT` but permits `cred://` references `[mutation.ts:looksLikeSecret]`, `[mutation.ts:ConfigMutationService]`.
- `set` validates the resulting config and throws `INVALID_RESULT` on any error-level issue before writing `[mutation.ts:ConfigMutationService]`.
- A changed on-disk config since the recorded read throws `CONCURRENT_MUTATION` `[mutation.ts:ConfigMutationService]`.
- Mutations persist through `withoutDerivedModelProjections`, so `model` and every `subagents` tier key are stripped while non-default `enabled` and `roles` survive `[mutation.ts:ConfigMutationService]`, `[persistence.ts:withoutDerivedModelProjections]`.
- Provenance is a bounded JSONL log keeping the last 100 entries, and each appended entry's `version` is the prior entry count plus one `[mutation.ts:ConfigMutationService]`.
- `buildProfilePatch` emits only `modelProfile` and `models`, maps profile vocabulary through `PROFILE_TIER_MAP`, and skips tiers mapped to `undefined` `[profile-patch.ts:buildProfilePatch]`, `[profile-types.ts:PROFILE_TIER_MAP]`.
- `applyProfilePatch` merges patch tiers over existing tiers and strips derived projections `[profile-patch.ts:applyProfilePatch]`.
- `loadProfiles` caches results and skips invalid profile JSON files with a console error; `listProfiles` returns `[]` when loading throws `[profile-registry.ts:loadProfiles]`, `[profile-registry.ts:listProfiles]`.
- `validateProfile` rejects unknown tier keys, empty ids/names, and invalid modes or hardware fields `[profile-types.ts:validateProfile]`.
- `matchHardware` treats `cloud-only` profiles as API-key-only checks and reports `incompatible` or `partial` with reasons `[profile-registry.ts:matchHardware]`.
- `ReliabilityMatrix.getEntry` resolves exact, provider wildcard, model wildcard, full wildcard, then a hardcoded default; unknown edit formats default to `0.85` and unknown tool calls to `0.90` `[reliability-matrix.ts:ReliabilityMatrix]`.
- `resolveModelDescriptor` caches by `provider:modelName`, uses overrides first, and otherwise falls back to provider defaults `[context-limits.ts:resolveModelDescriptor]`.
- `createContextBudget` freezes its result and guarantees `requestedMaxOutputTokens ≤ budgetReservation ≤ policyReservation ≤ cap` `[context-budget.ts:createContextBudget]`.
- `preflight` is pure and reports `overageTokens` plus a per-category breakdown when the request exceeds `availableInputTokens` `[context-budget.ts:preflight]`.
- `classifyOverflow` returns `irreducible` only when the mandatory core alone exceeds available input `[context-budget.ts:classifyOverflow]`.
- `assertFits` throws `ContextBudgetOverflowError` for irreducible overflow and returns the reducible result otherwise `[context-budget.ts:assertFits]`.
- `assembleContext` is a single deterministic pass: mandatory overflow throws, `current_execution_state` is all-or-nothing, tiers 4–6 skip-and-continue, `older_context` is always chronological, unknown categories are silently skipped, and the result is frozen `[context-assembly.ts:assembleContext]`.
- `deriveCalibrationFactor` returns `SAFETY_FACTOR` for empty samples and clamps the p95 ratio to `CALIBRATION_CLAMP` `[calibration-store.ts:deriveCalibrationFactor]`, `[calibration-store.ts:CALIBRATION_CLAMP]`.
- `getCalibrationFactor` defaults to `SAFETY_FACTOR` when the provider has no entry `[calibration-store.ts:getCalibrationFactor]`.
- `checkBudget` reports `fail` above `failureMs`, `warning` above `warningMs`, and rounds to two decimals `[performance-budgets.ts:checkBudget]`.
- `checkAllBudgets` reports `unbudgeted` for names absent from `PERFORMANCE_BUDGETS` `[performance-budgets.ts:checkAllBudgets]`.
- `getSearchConfig` defaults to `brave`, accepts only `searxng` as the alternate, trims trailing slashes from the base URL, and returns the default on any error `[search-config.ts:getSearchConfig]`.
- `isSubagentsEnabled` reads absent config as disabled `[subagent-config.ts:isSubagentsEnabled]`.
- `scopeToolsByTask` always admits `CORE_TOOL_NAMES` on membership, admits extended tools on raw token overlap, and falls back to the full surface when no extended tool matches `[tool-scoping.ts:scopeToolsByTask]`.
- `ScopingProvenance.ranking` is a diagnostic content-token IDF ordering, not an admission rule `[tool-scoping.ts:ScopingProvenance]`.
- `ConfigSigner.generateKeyPair` produces Ed25519 keys encoded as spki/pkcs8 PEM `[signing.ts:ConfigSigner]`.
- `ConfigSigner.sign` canonicalizes every `.json` file except the signature, sorted by name, and writes the signature atomically `[signing.ts:ConfigSigner]`.
- `ConfigSigner.checkRollback` rejects a config version older than the last accepted version `[signing.ts:ConfigSigner]`.
- `ConfigSigner.evaluateTrust` treats an unsigned config in production mode as an error and marks trust false when any error-level issue exists `[signing.ts:ConfigSigner]`.
- `detectSystem` degrades individual probe failures to detected defaults rather than throwing `[hardware-detect.ts:detectSystem]`.

## Side Effects

- `loadConfig` reads the user and project `config.json` files and writes resolved provider keys into `process.env` `[loader.ts:loadConfig]`.
- `loadConfig` may lazily load the credential store when `cred://` references are present `[loader.ts:loadConfig]`.
- `loadConfig` records trust evaluation evidence best-effort when trust evaluation is requested `[loader.ts:loadConfig]`.
- `ConfigMutationService.read` and `checkConcurrency` read `config.json` from disk `[mutation.ts:ConfigMutationService]`.
- `ConfigMutationService` writes the config atomically through a `0o600` temp file and rename after creating the directory `0o700`, and rewrites `provenance.jsonl` atomically `[mutation.ts:ConfigMutationService]`.
- `writeConfig` writes the serialized config with two-space indentation and a trailing newline `[persistence.ts:writeConfig]`.
- `loadProfiles` reads profile JSON files from disk and emits `console.error` for invalid ones `[profile-registry.ts:loadProfiles]`.
- `ReliabilityMatrix.load` reads `reliability-matrix.json` synchronously and caches the instance `[reliability-matrix.ts:ReliabilityMatrix]`.
- `resolveModelDescriptor` may call the Anthropic models API when an Anthropic key is supplied `[context-limits.ts:resolveModelDescriptor]`.
- `detectSystem` probes local OS, CPU, RAM, GPU, and Ollama state and inspects configured API providers `[hardware-detect.ts:detectSystem]`.
- `loadCalibration` reads `calibration.json` and `saveCalibration` creates the directory and writes the file with two-space indentation and a trailing newline `[calibration-store.ts:loadCalibration]`, `[calibration-store.ts:saveCalibration]`.
- `getSearchConfig` reads the user config file from disk `[search-config.ts:getSearchConfig]`.
- `ConfigSigner.generateAndPersistKey` creates the key directory `0o700` and writes the private key `0o600` atomically via temp file and rename `[signing.ts:ConfigSigner]`.
- `ConfigSigner.sign` writes `config.sig` atomically with mode `0o600` `[signing.ts:ConfigSigner]`.
- `ConfigSigner` reads every `.json` file in the config directory when computing canonical bytes `[signing.ts:ConfigSigner]`.
- `ConfigSigner` writes the accepted-version stamp atomically when accepting a version `[signing.ts:ConfigSigner]`.

## Verification

- Run: `pnpm test`
