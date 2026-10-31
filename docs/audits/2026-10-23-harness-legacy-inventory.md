# Harness legacy model-config inventory — 2026-10-23

**Scope:** PRE-R010 / HC-11 / F-05, source `c0def71d`.
**Disposition:** inventory advanced; removal and Gate D remain blocked.
Companions: [acceptance matrix](2026-10-23-harness-acceptance-matrix.md),
[cutover plan](../harness-cutover-plan.md).

## Method and limits

GitNexus registered ALiX at `c0def71d`, but `context normalizeModelConfig --repo .`
returned symbol-not-found for a definition present in source; a concept query
returned unusable path data. This is unresolved graph coverage, not zero callers.
The following is source-verified literal inventory, not a complete dynamic-call
proof. No runtime source, stored user config, credentials, or approval was changed.

Reproduce source checks from repo root:

```bash
node .gitnexus/run.cjs context normalizeModelConfig --repo .
rg -n 'normalizeModelConfig|config\.model\b|config\.subagents\b' src tests scripts
rg -n '\.(model|subagents|modelTiers)(\?|\.|\[|\s*=)' src/operations/config src/agents src/execution src/coordination src/interfaces/cli scripts
rg -n 'getRoleModel|isSubagentsEnabled|getSubagentRole|withoutDerivedModelProjections|writeConfig\(' src tests scripts
```

Line references below refer to the pinned source. Paths are repository-relative.
The search has false positives (`model` is also a model-adapter/observation field);
only verified config uses are listed. External SDK users, destructured aliases,
computed property access and plugin serialization remain unqualified.

## Consumer and writer manifest

| Surface | Source | Contract / retirement consequence |
|---|---|---|
| Final compatibility projector | `src/operations/config/loader.ts:40` | `normalizeModelConfig` sets `model` from canonical `models.default`, derives six subagent tier entries, preserves behavior config. This is final projection ownership, not a claim there are no earlier merge writes. |
| Legacy default seeding | `src/operations/config/schema.ts:272` | Seeds canonical default only when absent; invalid-but-present canonical default must not silently fall back. Keep legacy input support distinct from output projection removal. |
| Input merge / streaming preparation | `src/operations/config/loader.ts:264`, `:292`, `:466`, `:510` | User/project overlays, legacy `model`, legacy `modelTiers`, subagents and streaming feed normalization. Pre-normalization legacy writes exist. |
| Loader validation reader | `src/operations/config/loader.ts:316` | `requireModel` reads projected provider/name; must migrate before removing projection. Preserve `requireModel: false` behavior. |
| Live worker model reader | `src/agents/subagent-manager.ts:581` | `getRoleModel` reads `config.subagents[style]`; spawn consumes it at line 292. Preserve role-style selection, fallback/error behavior and return shape when moving to canonical resolver. |
| Display / redaction reader | `src/interfaces/cli/commands/config.ts:271` | Projected model display redacts API key; replacing it must preserve redaction and avoid mutating canonical config through aliases. |
| Init fallback construction | `src/interfaces/cli/commands/init.ts:127` | Spreads `DEFAULT_CONFIG.model` when unresolved; default is undefined (`src/operations/config/defaults.ts:13`). Review error/default path rather than assigning a model. |
| Canonical resolver | `src/operations/config/model-resolver.ts:36` | `createModelResolver` uses canonical assignments and returns copies. Invalid-present tier shadows fallback. This is the existing replacement authority, not a second model resolver proposal. |
| Behavior readers | `src/operations/config/subagent-config.ts:13`, `:21` | `enabled` and `roles` are behavior, not legacy model projections. They must remain. |
| Behavior consumers | `src/agents/agent/agent.ts:158`; `src/runtime-state/runtime/runtime-builder.ts:75`; `src/operations/daemon/daemon-server.ts:81`; `src/coordination/kernel/coordination-tools.ts:294`; `src/interfaces/server/coordination-routes.ts:414`; `src/agents/subagent-cli.ts:533`; `src/agents/subagent-manager.ts:578` | Delegation enablement and role lookup cannot disappear with model-tier projection retirement. |
| Persisted shape | `src/operations/config/schema.ts:628` | `PersistedAlixConfig` omits top-level model; persisted subagents retain behavior only. Runtime and persisted types are distinct. |
| Shared strip/migration boundary | `src/operations/config/persistence.ts:49` | Seeds legacy default before stripping output projections; preserves non-default behavior. Removing seeding here could destroy the only historical assignment. |
| Standard config serialization | `src/operations/config/persistence.ts` `writeConfig` | Writes branded persisted config. |
| Init/model/profile writers | `src/interfaces/cli/commands/init.ts:143`; `src/interfaces/cli/commands/models.ts:190`; `src/operations/config/profile-patch.ts:74`; `src/models/model-install.ts:39` | Model-writing surfaces must continue through persistence boundary. |
| Config mutation writer | `src/operations/config/mutation.ts:390`, `:400` | Strips via shared boundary, then uses its own atomic writer. It does not call `writeConfig`; do not falsely inventory one universal serialization function. |
| Mutation-path deny | `src/operations/config/mutation.ts:209` | Rejects direct writes to model projections and non-behavior subagent paths; preserve this contract while migrating readers. |

## Historical formats and compatibility policy still needed

| Input / format | Current treatment | Decision needed before retirement |
|---|---|---|
| User/project JSON `model` | Loaded and seeded in memory; loading alone does not rewrite disk | Retention/deprecation policy, backup and downgrade path for historical files |
| Canonical `models` | Persistent assignment authority | Keep precedence, invalid-present behavior and copy semantics |
| JSON `modelTiers` | User/project merged and mapped into canonical tiers | Explicit compatibility policy and historical sample coverage; not automatically removed with projections |
| `subagents.<tier>` | Runtime-derived tier fields; stripped at model persistence boundary | Migrate supported runtime consumers first |
| `subagents.enabled` / `roles` | Behavior survives writes | Retain; not an L0 removal target |
| `ALIX_<TIER>_PROVIDER` / `MODEL`, `ALIX_STREAMING` | Model-setting overrides in loader | Preserve or separately deprecate; these are not provider API-key resolution, which remains store-only |

## Verification inventory (not freshly executed in this documentation pass)

| Tests | Constraints |
|---|---|
| `tests/config-loader.test.ts:510`–`:771` | Legacy migration, canonical precedence, six-tier derivation, copies, invalid-present behavior, behavior config and overrides |
| `tests/config/model-invariant.test.ts:50`–`:208` | Writer surfaces and no disk rewrite on legacy load |
| `tests/config/persistence.test.ts:35`–`:175` | Strip model tiers, retain behavior, avoid legacy assignment loss |
| `tests/config/mutation.test.ts:499`–`:580` | Reject projection writes; unrelated writes migrate legacy representation safely |
| `tests/config/model-resolver.test.ts` | Canonical resolver ignores projections |
| `tests/cli/subagent-precedence.vitest.ts` | Child path does not mutate compatibility projection |
| `tests/agents/subagent-manager.test.ts`; `tests/cli-discover.test.ts`; `tests/tui/workbench/coordination-runtime-integration.vitest.ts`; `tests/config/signing.test.ts` | Projection-dependent fixtures and signing assumptions require review, not blanket replacement |

## Reversible migration packages — design only

1. **Reader migration:** migrate worker tier selection to existing canonical
   resolver; replace loader validation/display assumptions; adapt affected
   fixtures. Preserve behavior config and legacy input seeding. No automatic disk
   rewrite. Verify default/tier/style selection, missing and invalid-present
   inputs, copy isolation, redaction, CLI/daemon/Inspector and child behavior.
   Rollback reader changes together; retain projector throughout this package.
2. **Interface retirement:** only after supported/dynamic/external consumers are
   enumerated and owner-reviewed, propose removal of output projection types and
   final projector. Keep persisted legacy-input policy explicit. Revert projector
   and consumers together; configuration backups remain readable by old release.
3. **Historical-data migration:** separately specify an opt-in, versioned,
   backed-up migration with collision policy, dry-run, interrupted-write recovery,
   and down-migration. The existing strip-on-write behavior is not a newly
   qualified Q04 migration utility. Preserve signing/trust semantics and secrets.

Stop on unresolved consumers, changed model selection, lost behavior/redaction,
failed restart/persistence tests, or a new authorization/boundary violation.
No package is implemented or approved here. F-05 is now a concrete manifest with
named completeness gaps; PRE-R010 and Gate D remain partial/unmet.


## 2026-10-28 current-HEAD compiler triage reconciliation

The 2026-10-23 inventory remains historical evidence. A fresh compiler-bound census at source commit `43d81e989464ca7ef7b9b59ff559244bc3dad56e` scanned 1,465 `src/` files and produced 30 schema-bound config-field references, 221 other-declared-field references, 54 unresolved named references, and **0 dynamic-config-key unresolved**. Independent agent triage plus a second ambiguity review classified all 54 named references as **5 genuine config consumers, 49 unrelated-domain references, 0 ambiguous**. The five genuine references are already represented by this inventory's loader `modelTiers` ingestion and CLI projected-model redaction groups.

This closes the **internal compiler-project unresolved-reference triage** for that source commit. It does **not** prove graph completeness, runtime usage, external/deep-import consumers, reflection/JSON-string consumers, files outside the compiler project, or retirement safety. PRE-R010 and Gate D therefore remain partial/unmet. Evidence: `benchmark/evidence/config-consumer-inventory-2026-10-28.json`, `benchmark/evidence/config-consumer-triage-2026-10-28.json`, and `docs/audits/2026-10-28-pre-r002-r010-consumer-triage.md`.
