Yes. That review is correct. The previous rewrite became an **architecture specification** instead of an **executable SDD plan**. The missing details are not cosmetic: the `FORBIDDEN` ordering, concrete 16-entry table, exact existing types, known bug fixes, and per-task green gates are what make this refactor safe.

The corrected plan should therefore be a **merge of the two artifacts**: retain the stronger architectural invariants from the rewrite, but restore the repository-specific implementation sequence and exact contracts from the original plan.

I would use the following as the replacement plan.

# Tool/Capability Taxonomy Unification — Corrected Executable Implementation Plan

## Goal

Collapse the four parallel tool/capability taxonomies into **one canonical metadata source**:

```text
src/tools/tool-registry.ts
```

The canonical registry already exists and must be extended/restructured using the repository's existing `ToolCapability` contract. Do **not** invent a new `ToolMetadata` contract.

The final architecture is:

```text
                    src/tools/tool-registry.ts
                              │
                    canonical ToolCapability
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
       Policy              Runtime           Discovery/
       mapping             consumers         health/CLI
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
                    derived capability views
```

There must be exactly one authoritative taxonomy.

The migration must preserve existing behavior except for one explicitly approved correction:

```text
file.create
file.delete
        ↓
filesystem.write
```

That correction must be documented and tested rather than hidden under the general "behavior-preserving refactor" rule.

---

# Architectural Invariants

## INV-1 — Single taxonomy authority

`src/tools/tool-registry.ts` is the sole authoritative source for tool/capability metadata.

## INV-2 — Existing contract

The registry uses the repository's existing `ToolCapability` type.

No parallel:

```ts
interface ToolMetadata
```

or equivalent replacement contract may be introduced.

## INV-3 — Canonical identity

Each canonical entry has one authoritative:

* `name`
* `capabilityId`
* `policyKey`
* `risk`
* `mutates`
* `domain`
* `alwaysInclude`
* `tags`
* `executionProfiles`

## INV-4 — Legacy compatibility mapping

For every canonical entry:

```ts
legacyCapabilityToCanonical(entry.policyKey) === entry.capabilityId
```

must hold.

This is an explicit migration invariant, not merely an implementation detail.

## INV-5 — Derived reverse mappings

Capability → tool mappings are derived from the canonical table.

They are not independently maintained.

## INV-6 — Policy semantics remain separate

`src/policy/capability-registry.ts` must not become the new canonical taxonomy.

Policy consumes canonical metadata and retains only genuinely policy-specific behavior.

## INV-7 — Runtime semantics remain separate

Runtime consumers use canonical metadata but do not own another tool taxonomy.

## INV-8 — Immutable metadata

Canonical entries are read-only.

## INV-9 — Intentional behavior correction

The only intended behavior change in this refactor is:

```text
file.create → filesystem.write
file.delete  → filesystem.write
```

in the canonical capability mapping.

## INV-10 — No silent taxonomy conflict

If an existing consumer contains a value that contradicts the canonical table, the discrepancy must be resolved explicitly.

It must not be silently merged.

---

# Canonical 16-Entry Table

The registry must contain the following **16 canonical entries** — the executable tool surface — with these exact values. The `policyKey` values come verbatim from `executor.ts` `CAPABILITY_MAP` (mirrored in `policy-gate.ts` `inferCapability`); the `capabilityId` values from `capability-map.ts` `LEGACY_TO_CANONICAL`; the identity set from the routers' `canHandle` surfaces. Corrected only where this plan says so.

| name               | capabilityId       | policyKey      | risk    | mutates | domain     | alwaysInclude | tags                      | executionProfiles |
| ------------------ | ------------------ | -------------- | ------- | ------- | ---------- | ------------- | ------------------------- | ----------------- |
| `file.read`        | `filesystem.read`  | `file.read`    | low     | false   | filesystem | true          | read,file,code,config     | — |
| `file.create`      | `filesystem.write` | `file.write`   | medium  | true    | filesystem | false         | write,file,create         | artifact |
| `file.delete`      | `filesystem.write` | `file.write`   | high    | true    | filesystem | false         | delete,file,remove        | artifact |
| `file.exists`      | `filesystem.read`  | `file.read`    | low     | false   | filesystem | false         | read,file,check           | — |
| `dir.search`       | `filesystem.search`| `file.search`  | low     | false   | filesystem | true          | search,file,directory,code| — |
| `shell.run`        | `shell.exec`       | `shell.run`    | high    | true    | shell      | false         | shell,command,run,execute | — |
| `patch.apply`      | `patch.apply`      | `patch.apply`  | high    | true    | code       | false         | patch,code,edit,modify    | — |
| `done`             | `task.complete`    | `task.complete`| low     | false   | system     | true          | done,complete,finish      | — |
| `delegate`         | `agent.delegate`   | `delegate`     | medium  | true    | agent      | false         | delegate,agent,subtask    | — |
| `web_search`       | `web.search`       | `web.search`   | low     | false   | network    | false         | web,search                | research |
| `web_fetch`        | `web.fetch`        | `web.fetch`    | medium  | false   | network    | false         | web,fetch                 | research |
| `create_skill`     | `tool.invoke`      | `tool.invoke`  | medium  | true    | system     | false         | skill,create,self-extend  | — |
| `list_extensions`  | `tool.invoke`      | `tool.invoke`  | low     | false   | system     | false         | extension,list,self-extend| — |
| `inspect_extension`| `tool.invoke`      | `tool.invoke`  | low     | false   | system     | false         | extension,inspect,self-extend| — |
| `create_hook`      | `tool.invoke`      | `tool.invoke`  | high    | true    | system     | false         | hook,create,self-extend   | — |
| `mcp.*`            | `mcp.invoke`       | `mcp.invoke`   | high    | true    | mcp        | false         | mcp,tool                  | — |

**Intentional capability corrections (the ONLY behavior changes):**

1. `file.create` → `capabilityId filesystem.write` (was `filesystem.create`).
2. `file.delete` → `capabilityId filesystem.write` (was `filesystem.delete`).

Both preserve `legacyCapabilityToCanonical("file.write") === "filesystem.write"` (INV-4). Nothing consumes the old `filesystem.create`/`filesystem.delete` ids.

**Why this identity set (the executable surface):**

Every name above is an executable tool with a live router `canHandle` + `execute` behind it: File `file.read/create/delete/exists/dir.search` (`tool-router.ts:32-38`), Shell `shell.run` (`:167`), Patch `patch.apply` (`:267`), Web `web_search/web_fetch` (`:455`), Self-extend `create_skill/list_extensions/inspect_extension/create_hook` (`:476`), Delegate `delegate` (`:437`), MCP `mcp.*` (`:396`), plus the `done` control tool. **`mcp.*` is the one wildcard** covering the dynamic `mcp.<server>.<tool>` family.

> **This replaces the earlier draft table.** The prior draft listed `file.write`, `file.list`, `shell.exec`, `process.exec`, `network.fetch`, `browser.navigate/extract/interact`, `code.search`, `code.edit`, `git.read`, `git.write` — those are POLICY CAPABILITY names (the `policy/capability-registry.ts:60-70` defaults + the legacy map), NOT executable tools. Locking them in as registry entries would create phantom metadata with no execution behind it, and drop real tools (`file.exists`, `done`, `delegate`, `web_search`, `web_fetch`, the self-extend family, `mcp.*`). The policy key space stays policy-owned (INV-6) until dedicated tools exist (see "Out of Scope — Future Tool Surface").

---

# Task 0 — Amend Supersession Sentinels Before Touching the Registry

This task is mandatory and must be the **first implementation change**.

The CAP-7/CAP-8 supersession tests currently list the canonical registry and policy-side registry as forbidden paths.

Specifically inspect:

```text
tests/capability/cap-7-supersession.test.ts
tests/capability/cap-8-supersession.test.ts
```

(`FORBIDDEN` arrays at `tests/capability/cap-7-supersession.test.ts:12-15` and `tests/capability/cap-8-supersession.test.ts:20-23`.) These are node:test files (`.test.ts`), run under `pnpm test:node`.

The lists currently include:

```text
src/tools/tool-registry.ts
src/policy/capability-registry.ts
```

The taxonomy-unification work intentionally modifies those files, so the sentinel lists must be amended **before** the registry is touched.

### Required change

Update the supersession sentinel fixtures so that:

* the taxonomy-unification work is permitted to modify `src/tools/tool-registry.ts`;
* the policy-side `CapabilityRegistry` is treated according to its actual post-migration role;
* unrelated forbidden legacy surfaces remain forbidden.

### Why this is first

If this task is not completed first, the first registry commit makes the branch red even though the implementation is correct.

This is not test weakening.

It is the established pattern used when a later architectural phase intentionally supersedes an earlier forbidden surface.

### Verify

Run the affected CAP-7/CAP-8 sentinel tests immediately.

Expected:

```text
PASS
```

No registry implementation changes occur in this task.

---

# Task 1 — Lock the Existing Canonical Contract

Inspect:

```text
src/tools/tool-registry.ts
```

and the existing:

```text
ToolCapability
```

definition.

Do not create a new metadata interface.

The canonical registry must retain the existing fields:

```text
name
capabilityId
policyKey
risk
mutates
domain
alwaysInclude
tags
executionProfiles
```

### Required tests

Add/retain a focused registry contract test that verifies:

```ts
expect(toolRegistry).toHaveLength(16);
```

and that every entry contains the required metadata.

Also verify:

```ts
new Set(names).size === names.length
new Set(capabilityIds).size === capabilityIds.length
```

where uniqueness is required by the existing contract.

### Verify

```text
tsc
registry contract tests
```

must be green before continuing.

---

# Task 2 — Encode the 16 Canonical Entries

Populate `src/tools/tool-registry.ts` from the already-established canonical table.

Do not reconstruct the table from memory.

Do not simplify it to:

```ts
{
  id,
  capabilities
}
```

The existing metadata is contractually significant.

Preserve:

* names;
* capability IDs;
* policy keys;
* risk classifications;
* mutation flags;
* domains;
* always-include behavior;
* tags;
* execution profiles.

Apply the deliberate corrections:

```text
file.create → filesystem.write
file.delete  → filesystem.write
```

### Required invariant

For every entry:

```ts
legacyCapabilityToCanonical(entry.policyKey) === entry.capabilityId
```

### Verify

Run:

```text
registry tests
legacy compatibility tests
TypeScript
```

before moving on.

---

# Task 3 — Add Explicit Canonical/Legacy Mapping Tests

Create focused tests for the compatibility invariant.

For every canonical entry:

```ts
expect(
  legacyCapabilityToCanonical(entry.policyKey)
).toBe(entry.capabilityId);
```

Include explicit assertions for:

```text
file.create → filesystem.write
file.delete  → filesystem.write
```

These tests prevent a future maintainer from accidentally restoring the old split capability identities.

### Verify

Only this mapping test and its direct dependencies need to run.

The task is green when the mapping contract passes.

---

# Task 4 — Determine the Disposition of the Policy `CapabilityRegistry`

Inspect:

```text
src/policy/capability-registry.ts
```

This is a **policy-side `CapabilityRegistry`** and is distinct from any other symbol named `CapabilityRegistry` elsewhere in the repository.

Do not confuse it with the capability-platform/runtime registry (`src/capability/registry.ts` + `src/capability/platform.ts`), which is UNRELATED and stays.

### Step 1 — Establish deadness first

Run:

```text
grep -rn "new CapabilityRegistry(" src --include="*.ts"
grep -rn "withCapabilityRegistry(" src --include="*.ts"
```

Expected: the ONLY `new CapabilityRegistry(` is `src/capability/platform.ts:106` (the PLATFORM registry — unrelated). `withCapabilityRegistry(` has zero callers. The policy class reaches production only as `import type` + optional deps never passed.

### Step 2 — Disposition

A never-constructed class is NOT a candidate for "convert to registry-derived adapter" — that would be speculative generality. The correct disposition is **DELETE** (executed in Task 12, after consumers are cleaned):

- `src/runtime/execution-authorization.ts` — drop the `capabilityRegistry?` dep and the "Step 1: Capability metadata" block (`capDef`/`riskLevel`), which ALWAYS produced `undefined` in production. Remove `riskLevel` from the two `emitAudit(...)` calls.
- `src/policy/policy-engine.ts` — drop `capabilityRegistry?` from `PolicyEngineSubsystems`, the `requiresApproval` block, `withCapabilityRegistry(...)` (no callers), and the `_capabilityRegistry` field.

### Do not

* move authorization logic into the tool registry;
* keep the dead policy class alive as an adapter;
* introduce a second compatibility taxonomy.

### Verify

Run:

```text
policy tests
execution-authorization tests
TypeScript
```

All must be green before continuing. (Deletion of the file itself is Task 12.)

---

# Task 5 — Establish Derived Capability Views

Add only the registry helpers actually required by consumers.

The preferred direction is:

```text
canonical tool entries
        ↓
pure derived lookup
        ↓
consumer-specific view
```

Examples may include:

```ts
getToolCapability(name)
getCapability(name)
getToolsForCapability(capabilityId)
getCapabilities()
```

Use the repository's existing naming conventions and exports.

Do not introduce a generic registry framework.

### Required invariant

No reverse mapping may contain independently maintained capability/tool data.

### Verify

Add focused tests for:

* tool → capability;
* capability → tools;
* unknown tool;
* unknown capability.

Run those tests plus TypeScript.

---

# Task 6 — Migrate Policy Consumers One Seam at a Time

Migrate each actual policy consumer individually.

The relevant consumers identified in the previous inventory include policy-gate / execution-authorization / policy-engine surfaces.

For each consumer:

1. replace its local taxonomy import;
2. preserve its existing API;
3. derive the required metadata from the canonical registry;
4. run its focused test suite;
5. commit only after green.

### Required sequencing

Do **not** migrate all policy consumers in one broad edit.

Each consumer is an independently reviewable seam.

### Verify after each seam

```text
consumer-specific tests
TypeScript
```

---

# Task 7 — Migrate `executor`

Migrate the executor's taxonomy lookup to the canonical registry.

The executor must consume canonical metadata rather than maintain a parallel capability classification.

Preserve:

* execution behavior;
* policy inputs;
* error behavior;
* tool identity;
* capability identity.

Do not alter executor architecture beyond the metadata source.

### Verify

Run the executor-specific test suite and TypeScript.

Only proceed if green.

---

# Task 8 — Migrate `card-loader`

The existing `card-loader.ts` contains a known partial-config bug involving:

```text
hasFiles
```

This must be preserved/fixed deliberately during the taxonomy migration.

The loader currently has logic that can treat a partial tool configuration incorrectly when determining file capability presence.

The canonical registry must not cause this behavior to regress.

### Required correction

Ensure `hasFiles` is computed from the effective canonical/loaded tool set rather than assuming the complete configuration is present.

The implementation must correctly handle:

```text
no tools configured
partial configuration
file-only configuration
non-file configuration
full configuration
```

### Verify

Add focused tests covering the partial-config cases.

Then run:

```text
card-loader tests
TypeScript
```

The `hasFiles` regression test must be green before continuing.

---

# Task 9 — `tools-health-provider` count tracks the registry (regression test)

Inspect:

```text
src/baseline/providers/tools-health-provider.ts
```

The current implementation ALREADY derives its tool count from the registry:

```ts
const registeredTools = registry.getAll().length;
```

There is **no hard-coded `8` to remove**. The requirement is therefore a TEST that the count tracks the canonical registry — not a "replace the hard-coded 8" fix.

### Required change

Add/retain a test asserting the health provider's `registeredTools` equals `buildDefaultToolIndex().registry.getAll().length` (Sentinel F). If any other file hard-codes a tool count (grep for `=== 8`, `tools.length` assertions), update it to derive from the registry.

### Required invariant

Adding/removing a canonical tool automatically changes the health-provider count.

### Verify

Run:

```text
tools-health-provider tests
TypeScript
```

---

# Task 10 — Migrate Remaining Discovery / CLI Consumers

Migrate the remaining consumers identified by the previous inventory, including relevant:

```text
server
CLI
tool discovery
health
```

surfaces.

Each migration must follow the same expand–contract pattern:

```text
existing API
    ↓
registry-backed implementation
    ↓
focused tests
    ↓
legacy source removal
```

Do not change external command/API behavior unless required by the canonical taxonomy correction.

### Verify per consumer

Each consumer is green independently before the next one is changed.

---

# Task 11 — Three-Axis Sentinel Compatibility

Inspect the three-axis sentinel.

It explicitly excludes the **policy-side `CapabilityRegistry`**.

This exclusion is intentional and must remain correctly understood during deletion/migration.

Do not modify the sentinel merely because the policy-side registry is being removed or converted.

The sentinel is guarding a different architectural boundary.

### Required verification

Confirm that:

1. the three-axis sentinel still protects its intended legacy surfaces;
2. the policy-side `CapabilityRegistry` exclusion remains valid;
3. deletion of the policy-side registry does not cause the sentinel to become semantically incorrect;
4. no unrelated forbidden surface was accidentally removed from the sentinel.

### Verify

Run the three-axis sentinel independently.

---

# Task 12 — Delete the Dead Policy Taxonomy + Remove Legacy Sources

### 12.1 Delete the policy-side `CapabilityRegistry`

```bash
git rm src/policy/capability-registry.ts tests/policy/capability-registry.test.ts
```

Verify no code imports remain:

```text
grep -rn "policy/capability-registry" src tests
```

Allowlist ONLY:
- `src/capability/evolution/a7-proposals.ts` (comment — `cap-9-supersession` asserts a7 does NOT import it, which stays true);
- `tests/capability/three-axis-sentinel.vitest.ts` (comment — its regex targets `capability/(registry|provider-resolver).js`, the PLATFORM registry, not the deleted file);
- `tests/capability/cap-7-supersession.test.ts` / `cap-8-supersession.test.ts` (already amended in Task 0).

### 12.2 Remove remaining legacy taxonomy sources

Only after every consumer has migrated and all preceding tasks are green:

* remove obsolete taxonomy arrays;
* remove obsolete capability maps;
* remove duplicate tool classification;
* remove obsolete exports;
* remove dead compatibility code;
* remove imports.

Before deleting a file or declaration, prove:

```text
no imports
no dynamic imports
no CLI references
no tests requiring it
no package export dependency
no generated-code dependency
```

### Important distinction

Do not automatically delete every file containing `CapabilityRegistry`.

There are **two unrelated `CapabilityRegistry` symbols** in the repository:

1. the policy-side taxonomy registry (`src/policy/capability-registry.ts`) — THIS consolidation deletes it;
2. the capability-platform/runtime registry (`src/capability/registry.ts`, constructed only in `src/capability/platform.ts:106`) — UNRELATED, must remain. The sentinels (`cap-12`, `three-axis`, `five-axis`, `single-registry`) enforce that `new CapabilityRegistry(` appears ONLY there; deleting the policy class must not disturb them.

### Verify

Run:

```text
tsc
sentinels: cap-12-sentinel, three-axis-sentinel, five-axis-sentinel, single-registry
all directly affected tests
```

---

# Task 13 — Repository-Wide Duplicate Taxonomy Scan

Search the repository for:

```text
capabilityId
policyKey
ToolCapability
tool registry
capability registry
file.create
file.delete
filesystem.write
tool counts
capability arrays
tool → capability maps
capability → tool maps
```

Classify every remaining occurrence.

Allowed categories:

1. canonical registry;
2. derived consumer;
3. test fixture;
4. documentation;
5. legitimate policy/domain semantic;
6. unrelated capability-platform registry.

Disallowed category:

```text
independent authoritative taxonomy
```

### Verify

The scan must demonstrate that there is exactly one authoritative taxonomy.

---

# Task 14 — Architecture Sentinel Tests

Add explicit architectural tests for the final state.

At minimum:

### Sentinel A — Canonical source

The canonical registry exists at:

```text
src/tools/tool-registry.ts
```

### Sentinel B — Policy is not a taxonomy authority

The policy-side registry does not define an independent capability table.

### Sentinel C — 16 entries

The canonical table contains exactly the established 16 entries.

### Sentinel D — Compatibility mapping

Every:

```text
policyKey
```

maps to the canonical:

```text
capabilityId
```

### Sentinel E — File correction

```text
file.create → filesystem.write
file.delete  → filesystem.write
```

### Sentinel F — No hard-coded health count

The health provider derives its count from the canonical registry.

### Sentinel G — No independent reverse map

Capability → tool views are derived.

---

# Task 15 — Full Verification

Only after all individual tasks are green, run the complete verification matrix.

## Type checking

```text
npm run typecheck
```

or the repository's established TypeScript command.

## Focused tests

Run:

```text
tool-registry tests
policy tests
executor tests
card-loader tests
tools-health-provider tests
CLI tests
server tests
three-axis sentinel
CAP-7 supersession sentinel
CAP-8 supersession sentinel
```

## Full test suite

Run the repository's complete test command.

## Static checks

Run:

```text
lint
format/check
architecture/sentinel checks
```

No task is considered complete merely because the final full suite passes.

Every migration seam must already have been green independently.

---

# Expand–Contract Sequencing

The entire refactor follows this sequence:

```text
1. Amend sentinels
        ↓
2. Establish/lock canonical contract
        ↓
3. Populate canonical 16-entry table
        ↓
4. Prove legacy mapping equivalence
        ↓
5. Convert policy taxonomy to registry-derived
        ↓
6. Add derived views
        ↓
7. Migrate one consumer at a time
        ↓
8. Fix known card-loader partial-config seam
        ↓
9. Remove hard-coded health count
        ↓
10. Migrate remaining consumers
        ↓
11. Verify unrelated CapabilityRegistry boundary
        ↓
12. Delete legacy taxonomy
        ↓
13. Repository-wide duplicate scan
        ↓
14. Architecture sentinels
        ↓
15. Full suite
```

At every arrow:

```text
implement
→ focused test
→ TypeScript
→ green
→ next task
```

---

# Required Intentional Behavior Change

The migration must explicitly record this correction:

```text
OLD (current canonical ids)

file.create → filesystem.create
file.delete  → filesystem.delete

NEW (unified)

file.create → filesystem.write
file.delete  → filesystem.write
```

This is intentional because create/delete are filesystem mutation operations and must share the canonical `filesystem.write` capability.

This is the **only intentional behavioral taxonomy correction** in the migration.

Tests must assert it directly.

---

# Known Repository Corrections Included in This Plan

The following known facts must not be lost during implementation.

## `card-loader.ts`

The partial-config `hasFiles` bug is explicitly covered by Task 8.

## `tools-health-provider.ts`

The provider already derives its count from the registry (`registry.getAll().length`); there is no hard-coded `8`. Task 9 adds the regression test asserting it tracks the registry.

## Three-axis sentinel

Its explicit exclusion of the policy-side `CapabilityRegistry` is preserved and validated in Task 11.

## Two `CapabilityRegistry` symbols

The two unrelated symbols must not be conflated.

Only the policy-side taxonomy registry belongs to this consolidation.

## Supersession sentinels

CAP-7/CAP-8 `FORBIDDEN` lists are amended **before** `src/tools/tool-registry.ts` or `src/policy/capability-registry.ts` is changed.

---

# Adding a Tool After Migration

The intended workflow for adding a NEW executable tool becomes:

```text
1. Add tool metadata to tool-registry.ts
2. Assign canonical capability (capabilityId + policyKey)
3. Implement the tool + router canHandle/execute
4. Consume registry metadata
5. Add behavior tests
```

Not (the pre-migration five-edit chain):

```text
1. Add tool
2. Add policy mapping
3. Add runtime mapping
4. Add discovery mapping
5. Add capability list
6. Hope all five agree
```

Because the registry is the single registration point, a new tool is a one-row change + its implementation (INV-10). The capability and policy mappings are derived, so they cannot drift.

# Adding a Capability After Migration

```text
1. Define canonical capability metadata (registry row for an existing tool, or a policy-only capability in the policy key space)
2. Associate tools with the capability (registry row)
3. Add policy semantics if required (policy-owned)
4. Add consumer behavior/tests
```

The capability's existence must be discoverable from the canonical registry or the explicitly policy-owned set.

---

# Out of Scope — Future Tool Surface (Roadmap, Not This Plan)

The 16-entry table is the CURRENT executable surface, not the ceiling. The following are genuine, likely additions — but each is a NEW EXECUTION SURFACE (new router + dispatch + tests), so they are explicitly OUT OF SCOPE for this consolidation and are recorded here as roadmap:

- **`file.write`** (create-or-overwrite) — today the only mutation paths are `file.create` (refuses when the target exists, `tool-router.ts:104`) and `file.delete`; a direct overwrite tool is the natural next tool.
- **`git.*`** — dedicated git tools (`git.commit`, `git.push`, `git.diff`, …) instead of everything through `shell.run` at the coarse `shell.exec` gate.
- **`browser.*` / `process.*` / `network.*`** — fine-grained tools for per-domain policy.

When any of these lands, the registry is already the one registration point: add the row, implement the tool, done. Their capability names (`git.read`, `git.write`, `browser.navigate`, `process.exec`, `network.fetch`, `code.search`, `code.edit`, `file.write`, `file.list`) REMAIN in the policy key space until their tools exist — they are policy concepts, not phantom registry rows.

---

# Commit Structure

Use one logical implementation commit per independently green task/seam.

Recommended sequence:

```text
test(capability): amend taxonomy supersession sentinels

refactor(tools): establish canonical ToolCapability registry

test(tools): lock canonical 16-entry taxonomy

test(tools): enforce legacy capability mapping

refactor(policy): derive capability metadata from tool registry

refactor(tools): add derived capability views

refactor(executor): consume canonical tool taxonomy

fix(card-loader): handle partial file capability configuration

refactor(health): derive tool count from canonical registry

refactor(cli): consume canonical tool taxonomy

refactor(server): consume canonical tool taxonomy

test(capability): preserve three-axis sentinel boundary

refactor(tools): remove legacy taxonomy sources

test(tools): add taxonomy architecture sentinels

docs(tools): document canonical taxonomy authority
```

Commit names should follow the repository's established conventional-commit style.

---

# Definition of Done

* [ ] CAP-7/CAP-8 `FORBIDDEN` lists are amended first.
* [ ] `src/tools/tool-registry.ts` remains the canonical authority.
* [ ] The existing `ToolCapability` contract is used.
* [ ] No parallel `ToolMetadata` contract exists.
* [ ] All 16 canonical entries are represented.
* [ ] Existing metadata fields are preserved.
* [ ] `file.create` maps to `filesystem.write`.
* [ ] `file.delete` maps to `filesystem.write`.
* [ ] `legacyCapabilityToCanonical(policyKey) === capabilityId` holds for every entry.
* [ ] The canonical 16-entry table matches the executable surface (no `file.write`/`git.*`/`browser.*`/`process.exec` phantom rows).
* [ ] `patch.apply` retains `capabilityId = "patch.apply"` — INV-4 holds, logged canonical unchanged.
* [ ] Policy metadata is derived from the canonical registry.
* [ ] Policy semantics remain policy-owned.
* [ ] Runtime/executor metadata is registry-derived.
* [ ] `card-loader.ts` partial-config `hasFiles` behavior is covered.
* [ ] `tools-health-provider.ts` no longer hard-codes `8`.
* [ ] Reverse mappings are derived.
* [ ] The three-axis sentinel retains its correct policy-registry exclusion.
* [ ] The two unrelated `CapabilityRegistry` symbols remain correctly separated.
* [ ] All legacy authoritative taxonomy sources are removed or converted to adapters.
* [ ] Consumer APIs are preserved unless an intentional change is explicitly documented.
* [ ] Every implementation task has a focused green gate.
* [ ] TypeScript passes after each migration seam.
* [ ] Focused tests pass.
* [ ] Architecture/supersession sentinels pass.
* [ ] Full test suite passes.
* [ ] Repository-wide duplicate scan finds no independent taxonomy authority.

---

# Final Architectural Contract

After this plan is implemented, the repository must satisfy:

```text
                     ┌─────────────────────────┐
                     │ tool-registry.ts        │
                     │                         │
                     │ 16 canonical entries    │
                     │ ToolCapability contract │
                     └────────────┬────────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
          Policy              Runtime              Discovery
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  ▼
                         derived metadata/views
```

There is **one taxonomy authority**, not four.

The registry contains **metadata**, not policy semantics or execution behavior.

Existing APIs are migrated by **implementation substitution**, not premature deletion.

Known repository-specific defects are handled explicitly.

Sentinels are updated **before** the files they protect are intentionally changed.

Every seam is independently green before the next seam begins.

The final full-suite run is confirmation of an already-controlled migration, not the first point at which correctness is evaluated.

That is the executable implementation plan.

