# ALiX Single-Source Model Configuration — Implementation Plan

«Status: Approved implementation plan
Goal: Make "models" the sole persistent source of model assignments.
Implementation principle: "loadConfig()" may derive compatibility projections in memory, but no writer may persist them.»

---

## 1. Objective

ALiX currently has several overlapping representations of model selection:

- "models.default"
- "models.<tier>"
- legacy "model"
- legacy/compatibility "subagents.<tier>"
- "modelProfile"

This creates multiple possible sources of truth and makes model precedence dependent on which subsystem happens to read which representation.

This change establishes one authoritative representation:

```
                    ┌─────────────────────┐
                    │ persisted config    │
                    │                     │
                    │ models              │
                    │ modelProfile        │
                    │ apiKeys              │
                    │ other config        │
                    └──────────┬──────────┘
                               │
                               │ loadConfig()
                               ▼
                    ┌─────────────────────┐
                    │ normalized runtime  │
                    │                     │
                    │ models              │ ← authoritative
                    │ model               │ ← derived
                    │ subagents.*         │ ← derived
                    └──────────┬──────────┘
                               │
                               │ pure reader
                               ▼
                    resolveModelConfig()
                               │
                               ▼
                         runtime model
```

### Single invariant

«Persisted model selection has exactly one source of truth: "models".»

"modelProfile" is provenance metadata only.

"model" and "subagents.*" are loader-owned compatibility projections.

Therefore:

- "models" is authoritative.
- "modelProfile" never participates in resolution.
- "model" never participates in runtime resolution after loading.
- "subagents.*" never participates in runtime resolution after loading.
- no writer may persist "model" as model-selection state.
- no writer may persist "subagents.<tier>" as model-selection state.
- migration from legacy "model" to "models.default" happens only in memory.
- "config.json" is never rewritten merely because it contained legacy model state.
- every configuration writer must cross the shared persistence boundary.

---

## 2. Architectural Rules

### 2.1 Persisted representation

The persistent representation contains:

```
models
modelProfile
apiKeys
runtime
other persisted configuration
```

It must not contain:

```
model
subagents
```

as model-selection state.

### 2.2 Loader projection

"loadConfig()" is the only place that produces compatibility projections.

Given:

```
models.default
models.thinking
models.coding
models.fast
models.critic
models.tiny
models.image
```

the loader produces:

```
model := models.default
```

and:

```
subagents.thinking := models.thinking ?? models.default
subagents.coding   := models.coding   ?? models.default
subagents.fast     := models.fast     ?? models.default
subagents.critic   := models.critic   ?? models.default
subagents.tiny     := models.tiny     ?? models.default
subagents.image    := models.image    ?? models.default
```

These projections are runtime-only.

### 2.3 Runtime resolution

New runtime code uses:

```
resolveModelConfig(config, tier?)
```

This function:

- reads "config.models" only;
- does not inspect "config.model";
- does not inspect "config.subagents";
- does not inspect "modelProfile";
- does not normalize;
- does not mutate;
- returns a defensive copy.

### 2.4 Model profile

"modelProfile" answers:

«Which preset/profile produced these model assignments?»

It does not answer:

«Which model should runtime use?»

Runtime resolution must never consult "modelProfile".

### 2.5 Canonical configuration tiers

The configuration tier vocabulary is closed:

```
default
thinking
coding
fast
critic
tiny
image
```

There is no "coder" configuration tier.

Profile vocabulary may contain "coder", but that is mapped explicitly to configuration tier "coding".

---

## Task 0 — Pre-flight repository audit

Before changing code, inventory all model readers and writers.

### Commands

```
rg 'config\.model|config\.models|subagents|modelProfile' src --glob '!**/*.test.*'
```

```
rg 'writeFile|writeJson|saveConfig|save.*Config|updateConfig|mergeConfig' src
```

```
rg 'set-default-model|config set-tier|set-tier' src tests
```

```
rg 'JSON\.stringify\(.*config|JSON\.stringify\(.*result|writeFile.*config' src
```

Also inspect:

```
rg 'applyProfile|buildProfilePatch|handleSetDefaultModel|handleSetTier|loadConfig' src
```

### Classification

Every model-related occurrence must be classified as one of:

- "authoritative-writer"
- "derived-reader"
- "profile-writer"
- "bootstrap-writer"
- "cli-writer"
- "runtime-reader"
- "migration-loader"
- "persistence-boundary"
- "legacy-reference"
- "test-only"

### Known writers discovered during pre-flight

The initial audit has already identified:

1. "src/cli/commands/init.ts"

   - currently writes "model" and "subagents";
   - must be migrated.

2. "src/models/model-install.ts"

   - has its own local "writeConfig";
   - can receive the branded persisted representation from profile application;
   - must use the shared persistence boundary;
   - otherwise the brand would either leak conceptually or bypass the architectural write boundary.

3. "src/cli/commands/run.ts"

   - contains live user guidance referencing removed commands;
   - must be updated.

4. "tests/manual/suite-c-config.test.ts"

   - executes removed commands;
   - must be migrated to the new command family.

5. "tests/fixtures/security/config-writers.json"

   - documents legacy commands;
   - must be updated.

### Hard gate

If the audit discovers any additional writer that independently persists:

```
model
subagents
subagents[tier]
```

that writer must be explicitly migrated before proceeding.

Do not classify an uncovered writer as an acceptable legacy exception.

The invariant is about the persisted state, not merely the preferred modern path.

---

## Task 1 — Canonical model types

Files

```
Modify:
src/config/schema.ts
src/config/profile-types.ts
```

No behavior changes yet.

### 1.1 Canonical "ModelTier"

In "schema.ts":

```ts
export const MODEL_TIER_VALUES = [
  "default",
  "thinking",
  "coding",
  "fast",
  "critic",
  "tiny",
  "image",
] as const;

export type ModelTier = typeof MODEL_TIER_VALUES[number];

export const MODEL_SUBAGENT_TIERS = [
  "thinking",
  "coding",
  "fast",
  "critic",
  "tiny",
  "image",
] as const;

export type ModelsConfig =
  Partial<Record<ModelTier, ModelConfig>>;

export type DerivedSubagentConfig =
  Partial<
    Record<
      Exclude<ModelTier, "default">,
      ModelConfig
    >
  >;
```

"MODEL_TIER_VALUES" is the single runtime/type vocabulary.

Do not create another tier array elsewhere.

### 1.2 Boundary guard

```ts
export function isModelTier(
  value: string,
): value is ModelTier {
  return (
    MODEL_TIER_VALUES as readonly string[]
  ).includes(value);
}
```

This is for arbitrary external input.

"resolveModelConfig()" does not need this guard because its API accepts "ModelTier".

### 1.3 Persisted configuration type

Use a genuinely nominal persisted representation.

Prefer a type-only unique-symbol brand:

```ts
declare const persistedConfigBrand: unique symbol;

export interface PersistedAlixConfig
  extends Omit<AlixConfig, "model" | "subagents"> {
  readonly [persistedConfigBrand]: true;
}
```

The brand is type-only.

It must not be implemented as an enumerable runtime property.

Therefore:

```
{
  "models": {}
}
```

is written to disk rather than:

```
{
  "models": {},
  "__persistedConfigBrand": true
}
```

The only function allowed to construct this type is the persistence strip helper introduced in Task 4.

### 1.4 "AlixConfig" documentation

Document:

```
/**
 * Runtime configuration.
 *
 * Persisted model selection:
 *   models
 *
 * Loader-owned compatibility projections:
 *   model
 *   subagents
 *
 * model and subagents MUST NOT be persisted.
 */
```

Change:

```
models?: Record<string, ModelConfig>
```

to:

```
models?: ModelsConfig
```

### 1.5 Profile tier vocabulary

Rename the existing profile type:

```
ModelTier
```

to:

```
ProfileModelTier
```

The profile vocabulary remains:

```
default
planner
researcher
coder
critic
embeddings
classifier
```

because those are profile concepts, not configuration concepts.

Define the mapping once:

```ts
export const PROFILE_TIER_MAP:
  Record<ProfileModelTier, ModelTier | undefined> = {
    default: "default",
    planner: "thinking",
    researcher: "fast",
    coder: "coding",
    critic: "critic",
    embeddings: "tiny",
    classifier: undefined,
  };
```

This explicitly resolves:

```
profile coder → config coding
```

There is no "coder" configuration tier.

### 1.6 Tests

Add type/runtime coverage for:

- canonical tier acceptance;
- "coder" rejected as config tier;
- "coding" accepted;
- profile "coder" maps to config "coding";
- "classifier" has no config mapping.

### 1.7 Verification

```
pnpm build
npx tsc --noEmit
```

---

## Task 2 — Loader normalization

Files

```
Modify:
src/config/loader.ts
tests/config-loader.test.ts
```

### 2.1 "normalizeModelConfig"

Implement:

```ts
export function normalizeModelConfig(
  config: Partial<AlixConfig>,
): void
```

The function mutates the runtime object only.

It never writes to disk.

### 2.2 Migration rule

Legacy "model" seeds "models.default" only when:

```
config.models?.default === undefined
```

and:

```
config.model?.provider
config.model?.name
```

are both valid.

Important:

```
models.default = invalid object
```

still means the default property exists.

Therefore legacy "model" must not replace it.

### 2.3 Projection rule

After migration:

```
config.model =
  valid(config.models?.default)
    ? clone(config.models.default)
    : undefined;
```

Then derive "subagents" from canonical tiers only.

For every:

```
thinking
coding
fast
critic
tiny
image
```

use:

```
models[tier] ?? models.default
```

but only project a valid model.

### 2.4 Deterministic replacement

Do not mutate existing "subagents".

Construct it from scratch.

This guarantees stale keys disappear:

```
subagents.bogus
subagents.coder
subagents.oldTier
```

must never survive normalization.

If no tier resolves, leave:

```
config.subagents = undefined;
```

This preserves the distinction between:

```
no model configuration
```

and:

```
model configuration exists but no valid subagent projection exists
```

### 2.5 Metadata preservation

Projections must retain all "ModelConfig" fields:

```
provider
name
temperature
contextWindow
maxOutputTokens
streaming
...
```

Use a shallow defensive clone:

```ts
function cloneModelConfig(
  model: ModelConfig,
): ModelConfig {
  return { ...model };
}
```

### 2.6 Wire into "loadConfig"

After final merge:

```
normalizeModelConfig(result);
```

and before model-required validation.

Do not call normalization from writers.

The loader is the only projector.

Update diagnostics to reference:

```
alix models set-default
```

rather than the removed command.

### 2.7 Tests

Cover:

1. legacy "model" migrates to "models.default";
2. migration is in-memory;
3. "models.default" wins over legacy "model";
4. invalid-but-present "models.default" still wins;
5. invalid legacy "model" does not migrate;
6. "model" derives from "models.default";
7. subagents derive from canonical tiers;
8. missing tier falls back to default;
9. invalid default does not become a fallback;
10. stale subagent keys disappear;
11. metadata survives projection;
12. empty config leaves "model" and "subagents" unset.

---

## Task 3 — Pure model resolver

Files

```
Create:
src/config/model-resolver.ts
tests/config/model-resolver.test.ts
```

Implement:

```ts
export function resolveModelConfig(
  config: AlixConfig,
  tier?: ModelTier,
): ModelConfig
```

### 3.1 Resolution rules

Default:

```
models.default
```

Explicit tier:

```
models[tier] ?? models.default
```

where:

```
tier === "default"
```

means:

```
models.default
```

### 3.2 Resolver restrictions

The resolver must not:

- inspect "config.model";
- inspect "config.subagents";
- inspect "modelProfile";
- mutate config;
- normalize config;
- validate arbitrary strings.

### 3.3 Defensive copy

Return:

```
{ ...model }
```

so callers cannot mutate persisted/runtime configuration accidentally.

### 3.4 Failure

Throw:

```
No model configured. Run: alix models set-default
```

when no valid model resolves.

---

## Task 4 — Shared persistence boundary

Files

```
Create:
src/config/persistence.ts
tests/config/persistence.test.ts
```

This task is critical.

All configuration writers must ultimately pass through this boundary.

### 4.1 Strip helper

```ts
export function withoutDerivedModelProjections(
  config: AlixConfig,
): PersistedAlixConfig {
  const {
    model: _model,
    subagents: _subagents,
    ...persisted
  } = config;

  return persisted as PersistedAlixConfig;
}
```

The cast is intentionally isolated here.

This is the trusted construction point for the nominal persisted representation.

### 4.2 Shared writer

```ts
export async function writeConfig(
  config: PersistedAlixConfig,
  configPath: string,
): Promise<void> {
  await writeFile(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );
}
```

No other configuration writer should independently serialize configuration.

### 4.3 Brand requirements

The brand:

- exists only at compile time;
- is not enumerable;
- is not serialized;
- cannot appear in "config.json".

A raw:

```
AlixConfig
```

must not satisfy:

```
PersistedAlixConfig
```

without passing through:

```
withoutDerivedModelProjections()
```

### 4.4 Tests

Verify:

- projections are removed;
- "models" survives;
- "apiKeys" survives;
- raw "AlixConfig" fails the type assignment;
- branded persisted config writes successfully;
- disk contains no "model";
- disk contains no "subagents";
- disk contains no brand property.

---

## Task 5 — Migrate profile persistence

Files

```
Modify:
src/config/profile-patch.ts
tests/config/profile-patch.test.ts
```

### 5.1 "buildProfilePatch"

Profiles must produce:

```
{
  modelProfile,
  models
}
```

only.

No:

```
model
subagents
```

### 5.2 Profile mapping

Use only:

```
PROFILE_TIER_MAP
```

No local "coder → coding" logic.

### 5.3 Profile merge semantics

Profiles are partial presets.

Therefore:

```
models = {
  ...existing.models,
  ...patch.models,
}
```

Patch tiers win.

Unspecified existing tiers survive.

The profile does not wipe unrelated model assignments.

### 5.4 "applyProfilePatch"

Return:

```
PersistedAlixConfig
```

not a normalized runtime config.

Lifecycle:

```
loadConfig()
      ↓
AlixConfig
      ↓
applyProfilePatch()
      ↓
PersistedAlixConfig
      ↓
writeConfig()
```

"applyProfilePatch()" must strip stale:

```
model
subagents
```

before returning.

### 5.5 Tests

Verify:

- profile produces "models.default";
- profile "coder" becomes "models.coding";
- no "model";
- no "subagents";
- stale runtime projections are removed;
- unrelated existing tiers survive;
- patch tiers win.

---

## Task 6 — Migrate "model-install.ts" to the persistence boundary

Files

```
Modify:
src/models/model-install.ts

Modify/add:
tests/models/model-install.test.ts
```

This task is required by the writer audit.

### 6.1 Problem

"model-install.ts" currently has its own local configuration write path.

That creates a second persistence boundary.

It is particularly dangerous because profile application now returns:

```
PersistedAlixConfig
```

and the local writer can bypass the invariant.

### 6.2 Required change

Remove the local raw configuration serialization path.

Import:

```ts
import {
  withoutDerivedModelProjections,
  writeConfig,
} from "../config/persistence.js";
```

Any runtime "AlixConfig" being modified must first be stripped:

```ts
const persisted =
  withoutDerivedModelProjections(config);
```

Then modify authoritative state under:

```
persisted.models
```

and write:

```ts
await writeConfig(persisted, configPath);
```

If the function already receives a "PersistedAlixConfig", pass it directly to "writeConfig()".

Do not cast arbitrary runtime configs to "PersistedAlixConfig".

### 6.3 Disk invariant tests

Model installation must be tested against the actual file:

```ts
const saved = JSON.parse(
  readFileSync(configPath, "utf8"),
);

assert.ok(saved.models);
assert.equal(saved.model, undefined);
assert.equal(saved.subagents, undefined);
```

Also assert that no brand property appears.

### 6.4 Hard requirement

After this task:

«"model-install.ts" must not have an independent configuration serialization implementation.»

---

## Task 7 — Migrate "init.ts"

Files

```
Modify:
src/cli/commands/init.ts

Modify/add:
tests/cli/init-command.vitest.ts
```

### 7.1 Problem

"init.ts" is a genuine bootstrap configuration writer.

It currently writes:

```
model
subagents
```

directly to "config.json".

This violates the single-source invariant even though the data is generated during initialization.

### 7.2 Required behavior

"alix init" must create:

```
models.default
```

and, where initialization explicitly selects tier models:

```
models.<tier>
```

It must never write:

```
model
subagents
```

### 7.3 Implementation

Construct an authoritative config:

```ts
const config: AlixConfig = {
  ...
  models: {
    default: selectedModel,
    ...
  },
};
```

Then:

```ts
const persisted =
  withoutDerivedModelProjections(config);

await writeConfig(
  persisted,
  configPath,
);
```

If initialization currently generates six identical subagent assignments, replace those assignments with the single:

```
models.default
```

because the loader will derive the six compatibility projections.

### 7.4 Tests

Run real initialization against a temporary directory and assert:

```
saved.models.default
saved.model === undefined
saved.subagents === undefined
```

Then load the resulting configuration through "loadConfig()" and assert that runtime compatibility projections are present.

This proves both halves:

```
init → canonical disk representation
load → compatibility projection
```

---

## Task 8 — "alix models set-default" and "set-tier"

Files

```
Modify:
src/cli/commands/models.ts

Test:
tests/cli/models-command.vitest.ts
```

### 8.1 "set-default"

Selection flow remains:

```
provider
   ↓
API key
   ↓
available models
   ↓
model selection
```

Persistence changes to:

```ts
const existing = await loadConfig(cwd);

const persisted =
  withoutDerivedModelProjections(existing);

persisted.models = {
  ...(persisted.models ?? {}),
  default: selected,
};

await writeConfig(
  persisted,
  configPath,
);
```

### 8.2 "set-tier"

Validate the external tier argument with:

```
isModelTier()
```

Do not allow:

```
coder
planner
bogus
```

Do allow:

```
thinking
coding
fast
critic
tiny
image
```

The "set-tier" command is intentionally restricted to non-default tiers; validate against "MODEL_SUBAGENT_TIERS". "default" is owned by "set-default".

The command must use the same canonical vocabulary as the rest of the system.

### 8.3 Merge semantics

Never replace the complete "models" object.

Use:

```
{
  ...(persisted.models ?? {}),
  [tier]: selected,
}
```

Therefore setting "coding" cannot erase:

```
models.default
models.fast
models.tiny
```

### 8.4 Writer restriction

Do not call:

```
normalizeModelConfig()
```

from these handlers.

The writer writes authoritative state.

The loader derives compatibility state.

### 8.5 Tests

Verify the actual file contains:

```
{
  "models": {
    "default": "...",
    "coding": "..."
  }
}
```

and does not contain:

```
model
subagents
```

Also verify unrelated model tiers survive "set-tier".

---

## Task 9 — Remove legacy CLI commands

Files

```
Modify:
src/cli.ts
src/cli/commands/run.ts

Tests:
tests/cli/cli-commands.test.ts
tests/manual/suite-c-config.test.ts
tests/fixtures/security/config-writers.json
```

Search all repository references.

### 9.1 Remove

Remove:

```
alix config set-default-model
alix config set-tier
```

from:

- dispatcher;
- help text;
- usage text;
- examples;
- error messages.

### 9.2 Behavioral test

Test actual CLI dispatch.

Legacy commands must produce an unknown/unrecognized command result.

Do not use source grep as the primary proof.

Test:

```
config set-default-model → unknown
config set-tier           → unknown
```

and:

```
models set-default
models set-tier
```

must not be classified as unknown commands.

Interactive completion itself is tested separately by the handler tests.

### 9.3 Live guidance

Update "src/cli/commands/run.ts".

Any message such as:

```
alix config set-default-model ...
```

must become:

```
alix models set-default ...
```

This is a live user-facing command reference, not historical documentation.

### 9.4 Existing tests

Migrate:

```
tests/manual/suite-c-config.test.ts
```

away from removed commands.

Update:

```
tests/fixtures/security/config-writers.json
```

so security/writer fixtures reference the canonical model commands.

### 9.5 Final legacy-reference scan

```
rg 'set-default-model|config set-tier' src tests
```

Remaining occurrences must be intentional historical/changelog references only.

No live source, test execution path, fixture, help text, or user-facing diagnostic may invoke the removed commands.

---

## Task 10 — Migrate runtime readers

Files

```
Modify:
src/agent/agent.ts
src/agent/session.ts
src/run/task-loop.ts
src/agents/subagent-cli.ts
```

### 10.1 General rule

Replace:

```
config.model.provider
config.model.name
```

with:

```
const { provider, name } =
  resolveModelConfig(config);
```

For tier-specific paths:

```
resolveModelConfig(config, tier)
```

### 10.2 "session.ts"

Preserve legitimate "ModelConfig" fields such as:

```
streaming
temperature
contextWindow
```

but obtain them through the resolved model rather than treating "config.model" as authoritative.

For example:

```
const model = resolveModelConfig(config);

model.streaming
```

### 10.3 "subagent-cli.ts"

Preserve precedence:

```
explicit invocation override
        >
models.<tier>
        >
models.default
```

An explicit provider/model override must return a concrete model without mutating:

```
config.model
```

or:

```
config.subagents
```

The tier path uses:

```
resolveModelConfig(config, tier)
```

### 10.4 Test

Add a precedence test:

```
explicit override
    beats models.coding
    which beats models.default
```

Also assert:

```
config.model
```

is unchanged.

---

## Task 11 — Final writer audit

This is a mandatory architecture gate.

Run:

```
rg 'config\.model\s*=|subagents\[[^]]*\]\s*=|\.subagents\.[a-z]+\s*=' \
  src --glob '!**/*.test.*'
```

Then:

```
rg 'model:|subagents' \
  src/cli/commands \
  src/models \
  src/config \
  --glob '!**/*.test.*'
```

Then:

```
rg 'writeFile|writeJson|JSON\.stringify|saveConfig|writeConfig' \
  src
```

For every writer, answer:

1. Does it serialize configuration?
2. Does it use "writeConfig()"?
3. Does it receive a "PersistedAlixConfig"?
4. Could "model" be serialized?
5. Could "subagents" be serialized?
6. Does it modify "models" rather than a compatibility projection?

### Completion criterion

There must be exactly one generic configuration serialization boundary:

```
src/config/persistence.ts → writeConfig()
```

Specialized writers may prepare data, but they must cross that boundary.

---

## Task 12 — Cross-cutting invariant test suite

File

```
Create:
tests/config/model-invariant.test.ts
```

This suite tests architecture rather than individual implementation details.

### 12.1 Profile persistence invariant

Given stale:

```
model
subagents
```

profile application must return:

```
model === undefined
subagents === undefined
```

while retaining:

```
models
modelProfile
```

### 12.2 "models set-default"

Run the real handler.

Read the resulting file.

Assert:

```
saved.models.default
saved.model === undefined
saved.subagents === undefined
```

### 12.3 "models set-tier"

Run the real handler.

Assert:

```
saved.models.coding
saved.models.default
saved.models.fast
```

survive appropriately.

Also assert:

```
saved.model === undefined
saved.subagents === undefined
```

### 12.4 "init"

Run the real initialization path.

Assert:

```
saved.models.default
```

exists and:

```
saved.model === undefined
saved.subagents === undefined
```

Then load it and verify the compatibility projections are generated.

### 12.5 "model-install"

Drive the real installation path.

Assert:

```
saved.models
saved.model === undefined
saved.subagents === undefined
```

and:

```
saved.__persistedConfigBrand === undefined
```

### 12.6 Loader migration

Start with:

```
{
  "model": {
    "provider": "legacy",
    "name": "legacy-model"
  }
}
```

Capture bytes before loading.

Call:

```
loadConfig()
```

Verify runtime contains:

```
models.default
model
subagents.thinking
subagents.coding
subagents.fast
subagents.critic
subagents.tiny
subagents.image
```

Then read the file again and assert:

```
after === before
```

This is the definitive migration-safety test.

### 12.7 Precedence

Verify:

```
models.default > legacy model
```

and:

```
models.<tier> > models.default
```

when the tier is present.

### 12.8 Invalid authoritative default

Given:

```
models.default = {
  provider: "",
  name: "",
}
```

and:

```
model = {
  provider: "legacy",
  name: "legacy",
}
```

verify:

- legacy does not replace "models.default";
- "model" projection is absent;
- tier-specific models remain independently resolvable;
- invalid default is not used as a fallback.

---

## Task 13 — Documentation and command surface cleanup

Search:

```
rg 'config set-default-model|config set-tier|set-default-model' \
  . --glob '!node_modules' --glob '!dist'
```

Update:

- CLI help;
- README;
- command documentation;
- examples;
- fixtures;
- test descriptions;
- error messages;
- live diagnostics.

Historical changelog entries may remain if clearly historical.

---

## Task 14 — Full verification

Run:

```
pnpm build
```

Then:

```
npx tsc --noEmit
```

Then targeted Node tests:

```
node --test \
  dist/tests/config-loader.test.js \
  dist/tests/config/model-resolver.test.js \
  dist/tests/config/persistence.test.js \
  dist/tests/config/profile-patch.test.js \
  dist/tests/config/model-invariant.test.js \
  dist/tests/models/model-install.test.js \
  dist/tests/cli/cli-commands.test.js
```

Vitest:

```
npx vitest run \
  tests/cli/models-command.vitest.ts \
  tests/cli/init-command.vitest.ts
```

Then:

```
pnpm test:vitest
pnpm test:node
```

Existing unrelated failures must be compared against the base branch.

---

## 13. Manual verification

After build:

### 13.1 Existing legacy configuration

Create:

```
{
  "model": {
    "provider": "deepseek",
    "name": "deepseek-chat"
  }
}
```

Run:

```
alix config show
```

It must display the active model.

Then inspect the file.

The file must remain byte-for-byte unchanged.

### 13.2 Set default

Run:

```
alix models set-default
```

Verify disk contains:

```
{
  "models": {
    "default": {
      "provider": "...",
      "name": "..."
    }
  }
}
```

and does not contain:

```
"model"
```

or:

```
"subagents"
```

### 13.3 Set tier

Run:

```
alix models set-tier coding
```

Verify:

```
models.default preserved
models.coding added
other models.* preserved
```

and:

```
model absent
subagents absent
```

### 13.4 Removed command

Run:

```
alix config set-default-model
```

Expected:

```
unknown/unrecognized command
```

Likewise:

```
alix config set-tier
```

---

## 14. Commit sequence

Use conventional commits.

Commit 1

```
feat(config): define canonical model tier vocabulary
```

Commit 2

```
feat(config): normalize model selection at loader boundary
```

Commit 3

```
feat(config): add pure model resolver
```

Commit 4

```
feat(config): establish shared persistence boundary
```

Commit 5

```
fix(config): persist profile model assignments under models
```

Commit 6

```
fix(models): route model installation through persistence boundary
```

Commit 7

```
fix(init): persist canonical models during initialization
```

Commit 8

```
feat(models): persist set-default and set-tier under models
```

Commit 9

```
feat(cli): remove legacy config model commands
```

Commit 10

```
refactor(config): resolve runtime models from models only
```

Commit 11

```
test(config): enforce single-source model invariants
```

Documentation cleanup may use:

```
docs(config): update model command documentation
```

---

## 15. GitNexus / repository impact checks

Before modifying high-impact functions, run the repository-required impact analysis for:

```
loadConfig
mergeConfig
buildProfilePatch
applyProfilePatch
handleModelsCommand
init
model-install configuration persistence
```

In particular inspect:

```
loadConfig
```

because changing the runtime representation can affect every caller.

Inspect:

```
applyProfilePatch
```

because its return type changes from a general runtime config to a persisted representation.

Inspect:

```
handleModelsCommand
```

because its persistence semantics change.

Inspect:

```
init
```

because initialization is a bootstrap writer and must now conform to the same persistence invariant.

---

## 16. Final architecture

After completion, the architecture must satisfy this model:

```
                         DISK
                          │
                          │
                    config.json
                          │
                          │
                    ┌─────▼─────┐
                    │ loadConfig│
                    └─────┬─────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        models (source)       compatibility projection
              │                ┌──────┴──────┐
              │                │             │
              │              model       subagents.*
              │
              ▼
       resolveModelConfig()
              │
              ▼
        runtime execution
```

The reverse direction is deliberately constrained:

```
runtime config
     │
     │ withoutDerivedModelProjections()
     ▼
PersistedAlixConfig
     │
     │ writeConfig()
     ▼
   disk
```

No writer may do:

```
runtime config
     │
     ├── model ────────────────► disk   ❌
     │
     └── subagents.* ─────────► disk   ❌
```

All model-writing paths converge on:

```
models
   │
   ▼
PersistedAlixConfig
   │
   ▼
writeConfig()
```

---

## 17. Non-negotiable invariants

The implementation is not complete unless all of these hold:

1. "models" is the only persisted model-selection source.
2. "modelProfile" is provenance only.
3. "loadConfig()" is the only compatibility projector.
4. Migration is in-memory only.
5. Legacy "model" seeds "models.default" only when "models.default === undefined".
6. Presence of "models.default" wins even when its value is invalid.
7. "models.<tier>" wins over "models.default".
8. Missing tier falls back to "models.default".
9. Invalid default is never used as a fallback.
10. "model" and "subagents" are deterministically replaced during normalization.
11. Stale/non-canonical subagent keys cannot survive normalization.
12. Full "ModelConfig" metadata survives projections.
13. "resolveModelConfig()" reads "models" only.
14. "resolveModelConfig()" is pure.
15. "resolveModelConfig()" returns a defensive copy.
16. No writer calls "normalizeModelConfig()".
17. Every configuration writer uses the shared persistence boundary.
18. "init.ts" writes "models", never "model"/"subagents".
19. "model-install.ts" writes through "writeConfig()".
20. Profile application returns persisted state without derived projections.
21. "models set-default" merges into "models".
22. "models set-tier" merges into "models".
23. Setting one tier cannot erase another tier.
24. Legacy CLI commands are behaviorally removed.
25. No live CLI guidance references the removed commands.
26. "coder" exists only in profile vocabulary; "coding" is the config tier.
27. "apiKeys" remains independent of model selection.
28. The persistence brand is type-only and never appears on disk.
29. A raw "AlixConfig" cannot be passed directly to "writeConfig()".
30. The final repository-wide writer audit is clean.

---

## 18. Completion criterion

The feature is complete only when:

```
                   ┌──────────────────────┐
                   │      models          │
                   │                      │
                   │ SINGLE SOURCE        │
                   │ OF TRUTH             │
                   └──────────┬───────────┘
                              │
                       loadConfig()
                              │
               ┌──────────────┴──────────────┐
               │                             │
          model projection             subagents projection
               │                             │
               └──────────────┬──────────────┘
                              │
                       runtime only
```

and every persistence path follows:

```
AlixConfig
    │
    ▼
withoutDerivedModelProjections()
    │
    ▼
PersistedAlixConfig
    │
    ▼
writeConfig()
    │
    ▼
config.json
```

with no alternate configuration writer capable of serializing "model" or "subagents".

The final proof is not merely that the new code looks correct. It is:

```
writer audit
+
type-enforced persistence boundary
+
real on-disk writer tests
+
loader migration byte-for-byte test
+
runtime precedence tests
+
behavioral CLI removal tests
```

Together these establish the single-source invariant as an executable architectural contract rather than a convention.
