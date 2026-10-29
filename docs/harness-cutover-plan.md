# Harness cutover plan (P0 — deliverable 5, PRE-R010 / PRE-R011)

**Status:** DESIGN ONLY. Nothing here is approved, scheduled, or authorized.
**Design source snapshot:** `64f2fdaf`; concrete consumer manifest in `audits/2026-10-23-harness-legacy-inventory.md`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §5 (PRE-R010/R011), §8 (P0-F, P0-H), §9.
**Publication / simplification:** HOLD (Q13). This plan executes nothing.

The cutover plan exists to make future consolidation **reversible and ordered**,
not to justify removal. Every step below has a rollback; a step without a rollback
is marked as requiring design before it can be scheduled.

---

## 1. Dependency order (what must precede what)

Derived from `harness-dependency-retirement-map.md` §1 and the PRD workstream
table (§8). An edge here is a hard prerequisite, not a suggestion.

```
P0-A inventory ──────────────► P0-B invariants ──────────► P0-C benchmark spec
                                                                    │
                                                                    ▼
                                                          P0-D baseline (Gate B)
                                                                    │
                              ┌─────────────────────────────────────┘
                              ▼
                    P0-E ablations (Gate C)   ◄── NOT AUTHORIZED (§12.4)
                              │
                              ▼
                    P0-F migration design (PRE-R010/R011)
                              │
                              ▼
                    P0-H agent-driven cutover qualification (Q04/Q05 + Gate E/F evidence)
```

**Current position: between P0-D and P0-E.** Gate B is HOLD, so nothing downstream
is schedulable. This is the single most important fact in this document.

---

## 2. Migration inventory — state of each candidate

### 2.1 L0 (whole-item removal candidates)

| ID | Item | Reader inventory | Status |
|---|---|---|---|
| HC-11 | `config.model` / `config.subagents` compatibility projections, single writer `normalizeModelConfig` (`src/operations/config/loader.ts:40-77`) | **PARTIAL** — concrete reader/writer manifest plus 2026-10-28 current-HEAD compiler triage; internal unresolved named/dynamic references are classified, while external/deep-import/reflection/runtime/graph completeness remains unresolved | **blocked on PRE-R010** |

This is the one genuine L0 candidate and it is **not ready to touch**. The
final projections have a loader owner and identified live readers; pre-normalization
merge writes and a distinct atomic persistence writer also exist. Reader completeness
is unresolved. Retiring a
projection with live readers is a breaking change to every one of them, and the
repo's own DOX rule (`Root AGENTS.md`, config contracts) makes the loader the only
projector — so removal must migrate readers first, never the writer first.

**Safe order:** enumerate readers → migrate each to the canonical `models` object
→ prove zero readers → remove the projection → keep the `noUnusedLocals` and
dead-module gates as the tripwire.

### 2.2 M2 (ablation-gated)

HC-01 (prompt sections) and HC-03 (patch format). **No removal is proposed here**;
`harness-ablation-report.md` records why no comparison is admissible yet. These
cannot enter a cutover until Gate C produces a keep/retire decision.
`harness-shim-catalog.md` also identifies mandatory coordination routing inside
HC-01's Parallel Execution section: whole-section deletion is unsafe. Preserve
that contract even in a future authorized advisory-text comparison.

### 2.3 S0/S1 (preserve — never cutover targets)

Scheduling, authorization, approval consumption, ownership, recovery, verification,
run ceilings, single-use approval. Listed here only to make explicit that they are
**out of scope for consolidation**; a cutover that touches them is a re-architecture,
not a simplification, and needs its own S0 review.

---

## 3. Per-step plan shape

Each schedulable step must carry all six fields before it can be admitted by policy and independent verification. This is
the template a future P0-H step must satisfy:

| Field | Requirement |
|---|---|
| **Concern** | exactly one concern per package (PRE-R011) |
| **Preconditions** | which inventory gap it closes; which gate it depends on |
| **Affected contracts** | named R1 ports / DOX-owned boundaries, with the file that owns each |
| **Tests** | the negative test that catches the regression, plus the parity table where authorization is involved |
| **Rollback** | revert-friendly: the change must be isolated to one commit with no data migration, or ship with a down-migration |
| **Stop condition** | what observation halts the step (e.g. an unreachable reader, a gate turning red) |

**Parity rule carried in from the root contract:** any change to what an
allow/deny/owned decision *authorizes* needs an expected-outcome table broader
than the implementation (`tests/ownership/path-scope.test.ts`), never a spot check.
A cutover step that touches authorization without that table is inadmissible and must remain `BLOCKED`.

---

## 4. Concrete migration packages — Q04 / Q05 design only

These are proposals, not execution approval. Supported surfaces to qualify are
packaged CLI, daemon, Inspector and user/project configuration files. External
deep-import consumers remain **unknown**; this document does not declare them
unsupported. Graph-qualified completeness and independent verifier/critic review remain prerequisites.
No compatibility promise is withdrawn here. Loading historical input must remain
non-mutating, and legacy input support is distinct from runtime output removal.

Graph-first file impact returned `risk: UNKNOWN`, ambiguous candidates with
`maxRisk: CRITICAL`, including unrelated symbol identities on this document's
file UID. Those counts/callers/processes are unusable; risk remains unresolved.
Literal inbound references were confirmed in the PRD, optimization experiment
spec, readiness report, acceptance matrix and legacy inventory. This edit changes
only design text; no runtime symbol or interface was changed.

### MP-01 — Runtime reader parity

**Responsible subsystem:** configuration; independent verifier/critic coverage must include worker/runtime and CLI behavior.
**Dependency:** independently verified PRE-R010 manifest and repaired graph coverage before implementation; baseline/gates plus machine-verifiable delegated authority before any runtime change. Keep final projector throughout this package.

**Input → output:** normalized configuration and role/style requests → existing
model-selection/display return shapes sourced from canonical `models` via
`createModelResolver`, without reading derived tier assignments. No disk output.
Preserve `subagents.enabled`/`roles`, model-setting overrides, legacy seeding,
missing-versus-invalid-present behavior and copy isolation.

**Affected files/contracts:**

- `src/agents/subagent-manager.ts`: migrate `getRoleModel` and spawn model
  consumption without changing role/style precedence or delegation enablement.
  **LANDED (2026-10-23) — reader only.** `getRoleModel` now resolves through
  `createModelResolver` against the canonical `models` object instead of
  `config.subagents[style]`. Precedence is unchanged (role style, then default),
  the result is a copy, and the spawn path is untouched. Pinned by
  `tests/agents/mp-01-reader-parity.vitest.ts`, whose disagreeing-projection case
  fails if the reader ever prefers the projection again. The other files listed
  in this package are **not** migrated.
- `src/operations/config/loader.ts`: migrate `requireModel` validation to
  canonical resolution; preserve `requireModel: false` and all input overlays.
- `src/interfaces/cli/commands/config.ts`: migrate model display, preserving API
  key redaction and avoiding aliases that mutate canonical assignments.
- `src/interfaces/cli/commands/init.ts`: review unresolved/default fallback;
  never invent a provider/model when `DEFAULT_CONFIG.model` is undefined.
- `src/operations/config/model-resolver.ts`: existing authority; no second
  resolver or alternate fallback policy. `schema.ts`, `defaults.ts`,
  `subagent-config.ts` and persistence formats remain compatible in this package.

**Verification proposal:** update `tests/agents/subagent-manager.test.ts`,
`tests/config-loader.test.ts`, `tests/config/model-resolver.test.ts`,
`tests/cli/subagent-precedence.vitest.ts`, `tests/cli-discover.test.ts` and
`tests/tui/workbench/coordination-runtime-integration.vitest.ts`. Explicit cases:
six tiers; default and explicit role/style selection; missing assignments;
invalid-present tier/default must not fall through; disabled delegation and
custom roles preserved; returned model objects independently copied; output
redacts secrets; load-only performs no write. Add integration coverage for
packaged CLI, daemon, Inspector and worker startup/restart with identical fixture
assignments; those additional cases are proposed, not claimed as existing tests.

**Stop / rollback:** any changed selected model, fallback error, behavior,
redaction, restart result or new boundary violation stops adoption. Revert reader
commit and its fixtures together. Projector and disk input remain intact, so no
down-migration is required. Record before/after fixture parity for independent verifier comparison.

### MP-02 — Runtime output-interface retirement

**Responsible subsystem:** configuration/API. CLI, daemon and Inspector supported-surface inventory must be independently verified; unresolved external consumers keep the package `BLOCKED`.
**Dependency:** MP-01 parity, complete independently verified consumers including dynamic and serialization paths, versioned Q05 compatibility/version policy, and machine-verifiable P0-H delegated authority. External deep-import uncertainty blocks removal until evidence resolves it; silence is not consent.

**Input → output:** canonical runtime config → runtime type/object without
top-level `model` or six derived `subagents.<tier>` outputs. Historical JSON
`model` and `modelTiers` ingestion remains supported; `subagents.enabled`/`roles`
survive. No data rewrite, schema-version bump or input deprecation is bundled.

**Affected files/contracts:** final `normalizeModelConfig` projection in
`src/operations/config/loader.ts`; runtime versus persisted type distinction and
legacy input seeding in `src/operations/config/schema.ts`; defaults in
`src/operations/config/defaults.ts`; compatibility stripping in
`src/operations/config/persistence.ts`. MP-01 consumers and any newly discovered
serializer/plugin consumer must be added to manifest before removal. Keep
`src/operations/config/mutation.ts` rejection of direct projection writes; removal
does not authorize previously forbidden mutation paths.

**Q05 delivery:** publish proposed old/new object examples and affected packaged
CLI/daemon/Inspector/config-file behavior for independent verifier/critic review; declare transition version and deprecation interval only from versioned compatibility policy (none invented here). Require exact release/consumer inventory and a machine-verifiable external-consumer disposition. Retain compatibility output until that evidence exists. Config
file aliases are governed by MP-03, not removed with output fields.

**Verification proposal:** `tests/config-loader.test.ts`,
`tests/config/model-invariant.test.ts`, `tests/config/persistence.test.ts`,
`tests/config/mutation.test.ts`, MP-01 suites and
`tests/config/signing.test.ts`: canonical runtime model selections unchanged;
target output projections absent; historical input accepted; behavior preserved;
all standard and atomic mutation writers persist canonical assignments; unrelated
writes do not erase legacy-only assignment; projection mutation still denied;
signed-config trust and load-only disk bytes unchanged. Run unused/dead-module
and boundary gates after edits; a text-search zero alone is insufficient proof.

**Stop / rollback:** any unowned consumer, model-selection mismatch, changed
supported surface or trust/signature regression stops retirement. Revert output
type/projector and dependent consumers as one reviewed compatibility unit; reader
migration can remain only if old projector remains compatible. No disk migration
occurred, so restore code to recover old outputs. Require both old/new runtime
loads over unchanged historical fixtures before accepting rollback.

### MP-03 — Opt-in historical JSON migration protocol

**Responsible subsystem:** config persistence; signing/trust and credential-store behavior require independent security verification. **Dependency:** historical sample inventory, selected target/old release compatibility policy, verified transaction/recovery design, independent security qualification, and machine-verifiable P0-H delegated authority.
Can be designed independently of MP-02; must not be used to force input removal.

**Input → output:** explicitly selected user/project JSON containing legacy
`model`, `modelTiers`, or tier projections → staged canonical assignments and
unchanged behavior/unrelated fields, plus private backup and migration manifest.
Loading alone still writes nothing. Existing seeding and compatibility inputs
remain until separate approved deprecation. Model-setting environment overrides
(`ALIX_<TIER>_PROVIDER`/`MODEL`, `ALIX_STREAMING`) remain supported; provider
API-key resolution stays store-only.

**Affected existing boundaries:** `src/operations/config/schema.ts`
`seedLegacyModelDefault`; `loader.ts` legacy merges/normalization;
`persistence.ts` `withoutDerivedModelProjections` and `writeConfig`;
`mutation.ts` separate atomic persistence path; `profile-patch.ts`;
`src/interfaces/cli/commands/init.ts`, `models.ts`, `config.ts`;
`src/models/model-install.ts`; `src/operations/config/signing.ts`. A future
migration command/module needs its own impact/DOX review; no executable utility
or new CLI flag exists by virtue of this plan. `writeConfig` is a simple file
write today: do not claim it already provides a multi-file migration transaction.

**Proposed protocol:**

1. Explicitly select files and scope; reject symlink/path substitutions and
   unauthorized locations. Read immutable preimages; record private content
   hashes, file permissions, original schema/assignments and active trust state.
   Dry-run validates schema and compares selected models, emits only redacted
   changes/conflicts, and makes **zero writes**, backups or credential lookups
   that alter state. Do not fold user/project files into one merged output.
2. Collision policy: canonical assignment wins when valid; legacy seeds only
   absent canonical default/tier. Invalid-present canonical assignment is an
   error, never silently repaired. Conflicting legacy representations stop for
   explicit resolution; preserve originals. Unknown fields remain byte-preserved
   where possible and semantically preserved otherwise; duplicate JSON keys or
   lossy/unrepresentable old-release fields stop migration.
3. Verify existing signatures and trust before transformation. Missing/untrusted
   key, invalid signature or anti-rollback denial stops signed migration; never
   trust a new key or disable verification automatically. Staged transformed
   config must be validated, signed through existing authorized signing
   authority, and checked under original trust policy. Signature/version/
   provenance updates belong to the same reviewed recovery unit as config.
4. Before mutation, create restrictive, same-owner backups plus transaction
   manifest. Recheck preimage hashes immediately before commit; concurrent
   changes abort. Stage files on same filesystem with restrictive permissions;
   flush staged contents and recovery metadata. A rename of one file is not
   atomicity for config/signature/provenance/version stamp together. Until a
   reviewed journal/lock/recovery protocol can guarantee readers see a verified
   old or new generation, multi-file commit remains blocked. Inject failures
   before/after each stage in tests; interrupted startup must fail closed or
   recover verified generation, never execute mixed state.
5. Secrets: credential-store entries and `cred://` references remain unchanged.
   Never resolve/copy keys into reports, repository files, argv or environment.
   Treat original config backups as secrets when historical input contains
   literals; keep them private outside repo with restrictive permissions and a versioned retention policy. Legacy secret relocation is a separate
   credential migration, never an incidental model-field edit.
6. Idempotence: content/generation-bound manifest identifies completed migration;
   second run reports no change and does not create another signature, provenance
   event or version increment. Partial manifest requires verified recovery, not
   guessing success. Report input/output hashes privately, schema/generation,
   validation results, backup location and exact redacted outcome.

**Q04 down-migration:** before adoption, load staged output with chosen old and
new release fixtures. Prefer restoring verified byte backup when compatible
with current trust generation. Do **not** lower anti-rollback stamp to revive an
old signature. If restoration needs current monotonic generation, rebuild old
representation from backup and sign an authorized new generation, preserving
current trust rules. Stop if old release cannot read representation, current
canonical data cannot be represented losslessly, post-migration edits conflict,
backup/key unavailable, or signing authority absent. Never overwrite newer user
changes with backup. Exact target-version decision must come from versioned compatibility policy or remain `BLOCKED`.

**Verification proposal:** extend `tests/config-loader.test.ts`,
`tests/config/model-invariant.test.ts`, `tests/config/persistence.test.ts`,
`tests/config/mutation.test.ts`, `tests/config/signing.test.ts` with fixtures for
legacy-only/default/tier mixtures, canonical collisions and invalid-present
values, behavior/custom roles, unknown fields, duplicate-key rejection, missing
and revoked/untrusted keys, tampering/rollback, credential references/literals,
dry-run zero writes, concurrent modification, interrupted transaction at every
stage, retry idempotence, secret-free diagnostics and permission preservation.
Old/new release round-trip and rollback-after-user-edit conflict cases must pass.
These protocol tests and migration utility are **not implemented** by this doc.

### Package acceptance / outstanding approval

Q04/Q05 now have concrete proposals, affected files, parity cases, recovery and
stop criteria. Gate D remains **NOT MET**: graph/external/deep-import/reflection/runtime completeness,
target-version compatibility decisions, independent verifier/critic review, executable transaction qualification, and security qualification are unresolved. No package may be executed,
no alias removed, and no sign-off inferred from this design.

---

## 5. Risk register

| Risk | Trigger | Mitigation |
|---|---|---|
| Silent reader breakage | retiring a projection with an uninventoried reader | F-05 must close first; `noUnusedLocals`/dead-module gates plus an import-count audit |
| Authorization regression during consolidation | moving a decision across a seam | path-scope parity table; R1 freeze shrink-only |
| Losing durability guarantees | collapsing ledger + projection | the ledger stays authoritative (S0); a cutover may only remove projections |
| Benchmark invalidation | changing prompt/behavior mid-baseline | baseline frozen per commit; cutover starts only after Gate B signs |
| Irreversibility | a step needing data migration | no such step may ship without a down-migration (see §3 rollback) |

---

## 6. Explicit non-decisions

- **No retirement is approved.** HC-11 is blocked, HC-01/HC-03 are unmeasured.
- **Migration packages are proposed, not approved or implemented.** Q04/Q05 completeness and independent verification remain open.
- **No production change may exceed delegated authority.** Missing machine-verifiable authority yields durable `BLOCKED`; §12.4 and Q13 external release boundaries still stand.
- **No dates.** Duration estimates would be invented; the PRD forbids fabricated
  numeric targets, and a schedule derived from nothing is the same defect.

---

## 7. Verdict

**Gate D: NOT MET.** PRE-R010 is partially met (the one L0 candidate is
characterised and its concrete readers are enumerated, but supported-interface
completeness remains unresolved); PRE-R011 now has three concrete design-only
packages, not an approved or qualified complete cutover plan.

The plan's value today is the ordering constraint it records: **nothing downstream
of P0-D is schedulable while Gate B is HOLD**, and the first real step is a reader
inventory — a read-only task that needs no authorization beyond the current
audit mandate.
