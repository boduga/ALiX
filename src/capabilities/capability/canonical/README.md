# Canonical Capability Model

## Overview
Canonical, provider-independent description of what ALiX can do. A capability is pure data: a semantic kind (`core`/`query`/`operation`/`workflow`/`agent`), a full SemVer version, and one or more declarative provider bindings describing how it is implemented. This package supplies the definition/provider validators, the SemVer helpers, a durable catalog with source-precedence bootstrap, and a two-phase authoring assessment. Capability identity is independent of provider technology.

## Interface
- `CapabilityKind` (`core|query|operation|workflow|agent`) with `CAPABILITY_KINDS` and `isCapabilityKind()` [kind.ts:CapabilityKind]
- `LegacyKind`/`migrateKind()` — maps legacy `tool`/`skill`→`operation`, `plugin`→`agent`; rejects `custom` [kind.ts:migrateKind]
- `ProviderType` (`native|tool|mcp|external-cli|daemon|agent|plugin|remote-api`) and `PROVIDER_TYPES` [provider.ts:ProviderType]
- `CapabilityProviderBinding` and `validateProviderBinding()` [provider.ts:CapabilityProviderBinding], [provider.ts:validateProviderBinding]
- `CapabilityDefinition`, `CapabilityRisk`, `CapabilityPermission`, `validateCapabilityDefinition()` [definition.ts:CapabilityDefinition], [definition.ts:validateCapabilityDefinition]
- `isValidVersion()`, `parseVersion()`, `formatVersionId()`, `parseVersionId()`, `compareVersions()`, `bumpVersion()` [version.ts:isValidVersion], [version.ts:compareVersions]
- `CapabilityDefinitionStore` — JSONL-backed durable store [catalog-store.ts:CapabilityDefinitionStore]
- `CapabilityCatalog`, `CapabilityCatalogPatch` [catalog.ts:CapabilityCatalog]
- `CapabilityBootstrapEntry`, `CapabilityBootstrapProvider`, `BOOTSTRAP_SOURCE_ORDER`, `loadCatalogWithPrecedence()` [bootstrap.ts:loadCatalogWithPrecedence]
- `DefinitionAuthoringStatus`, `AuthoringAssessment`, `evaluateDefinitionAuthoring()` [authoring.ts:evaluateDefinitionAuthoring]
- Barrel re-exports all modules [index.ts]

## Invariants
- `kind` must be a semantic `CapabilityKind`; provider technologies such as `tool`/`mcp`/`native` are rejected as kinds [definition.ts:validateCapabilityDefinition]
- `version` must be full SemVer `MAJOR.MINOR.PATCH`; a partial version fails validation [version.ts:isValidVersion]
- Every definition must declare at least one provider binding, and each binding is validated [definition.ts:validateCapabilityDefinition]
- `allowFallbacks` defaults to true (declared-order failover); `false` restricts execution to `bindings[0]` [definition.ts:CapabilityDefinition]
- `extensions`, `argsSchema`, and `resultSchema` must be plain JSON-serializable records — functions, Dates, Maps, Sets are rejected [definition.ts:isSerializable]
- `risk` is one of `low|medium|high|critical`; `requiredPermissions` contains only `operator|admin|developer|internal` [definition.ts:RISK_LEVELS], [definition.ts:VALID_PERMISSIONS]
- `external-cli` bindings require a non-empty `config.executable` [provider.ts:validateProviderBinding]
- `migrateKind` rejects legacy `custom` because it has no semantic equivalent [kind.ts:migrateKind]
- `parseVersion` and `parseVersionId` throw on malformed input; `parseVersionId` splits at the last `@` [version.ts:parseVersion], [version.ts:parseVersionId]
- `getDefinition` returns the highest SemVer for an id — a deterministic "current" [catalog-store.ts:getDefinition]
- `appendDefinition` rejects a duplicate `id@version` [catalog-store.ts:appendDefinition]
- Corrupt JSONL lines are skipped on load rather than failing the store [catalog-store.ts:CapabilityDefinitionStore]
- Bootstrap precedence: later sources win on the same `id@version`; an unknown source gets `-Infinity` rank so it can never override known content [bootstrap.ts:sourceRank]
- Authoring status is `required` for empty input, `incomplete` with a missing-field list, and `valid` only after full canonical validation; the authoring path never invents defaults [authoring.ts:evaluateDefinitionAuthoring]

## Side Effects
- Reads `<dir>/capabilities/definitions.jsonl` and `<dir>/capabilities/bindings.jsonl` on construction and creates the directory on write [catalog-store.ts:CapabilityDefinitionStore]
- Writes are atomic: content is written to `<file>.tmp` then `renameSync`d into place [catalog-store.ts:atomicAppend]
- `replaceDefinition`/`removeDefinition` rewrite the whole definitions file; `removeDefinition` also drops the binding entry [catalog-store.ts:replaceDefinition], [catalog-store.ts:removeDefinition]
- No network access and no process spawning [catalog-store.ts:readLines]

## Verification
- Run: `pnpm test`
