Absolutely. Below is the version I would hand to an implementation agent. I’ve incorporated the corrections above and tightened the contracts so the implementation has fewer places where an agent can make a locally reasonable but architecturally wrong choice.

ALiX Single-Source Model Configuration Implementation Plan

«Status: Approved implementation plan
Goal: Make "models" the single persistent source of model assignments.
Scope: Configuration schema, loading/migration, model resolution, persistence, profiles, model CLI writers, legacy command removal, runtime readers, and cross-cutting invariant tests.

For agentic workers: Use "superpowers:subagent-driven-development" or "superpowers:executing-plans". Execute tasks in order. Each task is independently testable and should be committed before moving to the next task.»

---

1. Goal

Make "models" the single persistent source of model assignments throughout ALiX.

The existing "model" and "subagents.*" fields remain available only as loader-owned, runtime-only compatibility projections.

The legacy model-writing commands are removed and all model writers are consolidated under the "alix models" command family.

The single invariant

«Persisted model selection has exactly one source of truth: "models".»

"modelProfile" is provenance/metadata only. It identifies how the model configuration was selected, but never participates in runtime model resolution.

"model" and "subagents.*" are compatibility projections. They:

- may exist on the in-memory "AlixConfig";
- are produced exclusively by "loadConfig()";
- are never independently written;
- are never used by new runtime model-resolution code;
- must never become a second source of persisted model-selection state.

---

2. Architecture

The configuration lifecycle has three explicit layers.

                    ┌────────────────────────────┐
                    │      PERSISTED CONFIG      │
                    │                            │
                    │  models                    │
                    │  modelProfile              │
                    │  apiKeys                   │
                    │  all other persisted state │
                    └─────────────┬──────────────┘
                                  │
                                  │ loadConfig()
                                  ▼
                    ┌────────────────────────────┐
                    │       RUNTIME CONFIG       │
                    │                            │
                    │  models       authoritative │
                    │  model        derived       │
                    │  subagents    derived       │
                    └─────────────┬──────────────┘
                                  │
                                  │ resolveModelConfig()
                                  ▼
                    ┌────────────────────────────┐
                    │       MODEL RUNTIME        │
                    │                            │
                    │  pure resolution           │
                    │  reads models only         │
                    └────────────────────────────┘

The reverse persistence path is equally explicit:

runtime AlixConfig
       │
       │ withoutDerivedModelProjections()
       ▼
PersistedAlixConfig
       │
       │ writeConfig()
       ▼
config.json

Ownership rules

Concern| Owner
Persistent model assignment| "models"
Model-selection provenance| "modelProfile"
Legacy "model" migration| "loadConfig()"
"model" compatibility projection| "loadConfig()"
"subagents.*" compatibility projection| "loadConfig()"
Runtime model resolution| "resolveModelConfig()"
Persistence stripping| "withoutDerivedModelProjections()"
Persistence write boundary| "writeConfig()"
Model CLI writers| "alix models ..."
Profile → config mapping| "buildProfilePatch()"
Profile persistence| "applyProfilePatch()" + persistence boundary

---

3. Non-Negotiable Invariants

3.1 Single persistent source

All persisted model assignments MUST be under:

models

No writer may independently persist:

model
subagents.<tier>

as model-selection state.

---

3.2 Runtime projections

"loadConfig()" derives:

model := models.default

and:

subagents[tier] := models[tier] ?? models.default

for the six non-default subagent tiers.

These are compatibility projections only.

---

3.3 Loader is the only projector

"normalizeModelConfig()" is called by "loadConfig()".

No writer may call "normalizeModelConfig()".

Writers persist the authoritative representation only.

If a writer needs the normalized runtime representation afterward, it must call "loadConfig()" again.

---

3.4 Runtime resolution reads "models" only

New runtime code MUST use:

resolveModelConfig(config, tier?)

It MUST NOT resolve models using:

config.model
config.subagents

"resolveModelConfig()" knows nothing about "modelProfile".

---

3.5 Migration is in-memory only

When loading:

{
  "model": {
    "provider": "deepseek",
    "name": "deepseek-chat"
  }
}

the runtime configuration becomes:

{
  "models": {
    "default": {
      "provider": "deepseek",
      "name": "deepseek-chat"
    }
  }
}

with derived compatibility projections.

But the file on disk is not rewritten.

The original file must remain byte-for-byte unchanged.

---

3.6 "models.default" presence is authoritative

The migration rule is:

models.default === undefined
    + valid legacy model
    → migrate legacy model

models.default exists
    → never migrate legacy model

Validity does not determine precedence.

Therefore:

models.default = {
  provider: "",
  name: "",
}

is still authoritative over a valid legacy "model".

An invalid-but-present default is not a fallback candidate.

---

3.7 Tier precedence

For a non-default tier:

models.<tier>
    ↓ if absent
models.default
    ↓ if absent/invalid
resolution failure

An invalid "models.default" does not become a fallback source for another tier.

---

3.8 Empty state

If neither:

models

nor a valid legacy model exists, normalization must not create an empty:

subagents: {}

The result remains:

model === undefined
subagents === undefined

---

3.9 Canonical tier vocabulary

The configuration tier vocabulary is closed:

default
thinking
coding
fast
critic
tiny
image

There is no configuration tier named:

coder
planner
researcher
embeddings
classifier

Those belong only to the profile vocabulary.

---

4. Task 1 — Canonical Schema Types and Writer/Reader Audit

Files

Modify:

src/config/schema.ts
src/config/profile-types.ts

Audit only:

src/

No audit output needs to be committed unless project conventions require it.

---

Step 1 — Define canonical configuration tiers

In "src/config/schema.ts":

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

/**
 * Loader-owned compatibility projection.
 *
 * `default` is represented by `model`, therefore only the six
 * non-default tiers appear here.
 */
export type DerivedSubagentConfig =
  Partial<
    Record<Exclude<ModelTier, "default">, ModelConfig>
  >;

"MODEL_TIER_VALUES" is the canonical runtime/type source.

Do not define another independent list elsewhere.

---

Step 2 — Add the boundary validator

In "schema.ts":

export function isModelTier(
  value: string,
): value is ModelTier {
  return (
    MODEL_TIER_VALUES as readonly string[]
  ).includes(value);
}

This is used only at external boundaries such as:

- CLI arguments;
- config-file values;
- other arbitrary strings.

"resolveModelConfig()" does not need to perform this check because its API accepts "ModelTier".

---

Step 3 — Define the persisted configuration representation

Add:

export interface PersistedAlixConfig
  extends Omit<AlixConfig, "model" | "subagents"> {
  /**
   * Nominal persistence brand.
   *
   * This is required rather than optional so a raw AlixConfig cannot
   * structurally satisfy PersistedAlixConfig.
   *
   * The brand is removed before JSON serialization.
   */
  readonly __persistedConfigBrand:
    "PersistedAlixConfig";
}

The required brand is intentional.

A plain "Omit" is insufficient because TypeScript allows a structurally compatible variable containing extra properties to be passed to a function.

The required brand ensures that:

writeConfig(rawAlixConfig, ...)

is rejected unless the object has explicitly crossed:

withoutDerivedModelProjections()

---

Step 4 — Update "AlixConfig.models"

Replace loose model maps such as:

Record<string, ...>

with:

models?: ModelsConfig;

Document the split directly on "AlixConfig":

Persisted:
  models
  modelProfile
  apiKeys
  all other persisted configuration

Runtime-only projections:
  model
  subagents

"apiKeys" remains independent and is never coupled to model selection.

---

Step 5 — Align profile tier vocabulary

"src/config/profile-types.ts" currently defines a separate profile vocabulary.

Rename it:

export type ProfileModelTier =
  | "default"
  | "planner"
  | "researcher"
  | "coder"
  | "critic"
  | "embeddings"
  | "classifier";

Then define the typed mapping:

import type {
  ModelTier,
} from "./schema.js";

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

This is the only profile-to-config tier mapping.

Do not introduce a "coder" configuration tier.

The compiler must force the mapping to remain synchronized with the profile vocabulary.

---

Step 6 — Writer/reader audit

Before changing writers, run:

rg 'config\.model|config\.models|subagents|modelProfile' src \
  --glob '!**/*.test.*'

and:

rg 'writeFile|writeJson|saveConfig|save.*Config|updateConfig|mergeConfig' src

Classify every hit as:

- "authoritative-writer"
- "derived-reader"
- "profile-writer"
- "cli-writer"
- "runtime-reader"
- "migration-loader"

Hard gate

If the audit finds a writer that independently persists:

config.model
config.subagents
subagents[tier]

and that writer is not covered by Tasks 4–6:

STOP. Extend the plan before proceeding.

A missed writer is an architectural defect.

---

Step 7 — Build

Run:

pnpm build

Expected: clean.

---

Step 8 — Commit

git add src/config/schema.ts src/config/profile-types.ts

git commit -m "feat(config): define canonical model tier vocabulary"

---

5. Task 2 — Deterministic Loader Projection

Files

Modify:

src/config/loader.ts

Test:

tests/config-loader.test.ts

---

Contract

Create:

export function normalizeModelConfig(
  config: Partial<AlixConfig>,
): void

The function mutates the supplied runtime object.

It is:

- deterministic;
- loader-owned;
- never persisted directly;
- responsible for replacing both compatibility projections wholesale.

---

Step 1 — Tests

Add tests covering:

Legacy migration

test("legacy model seeds models.default in-memory", () => {
  const cfg: any = {
    model: {
      provider: "deepseek",
      name: "deepseek-chat",
    },
  };

  normalizeModelConfig(cfg);

  assert.deepEqual(
    cfg.models.default,
    {
      provider: "deepseek",
      name: "deepseek-chat",
    },
  );
});

Authoritative default

test("models.default wins over legacy model", () => {
  const cfg: any = {
    model: {
      provider: "legacy",
      name: "old",
    },
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
    },
  };

  normalizeModelConfig(cfg);

  assert.equal(
    cfg.models.default.name,
    "deepseek-chat",
  );

  assert.equal(
    cfg.model.name,
    "deepseek-chat",
  );
});

Projection

test("derives model from models.default", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
    },
  };

  normalizeModelConfig(cfg);

  assert.deepEqual(
    cfg.model,
    cfg.models.default,
  );
});

Deterministic subagent projection

test("replaces stale subagents wholesale", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
      coding: {
        provider: "openai",
        name: "gpt-4o",
      },
    },

    subagents: {
      coding: {
        provider: "old",
        name: "old",
      },
      thinking: {
        provider: "stale",
        name: "stale",
      },
      bogus: {
        provider: "x",
        name: "y",
      },
    },
  };

  normalizeModelConfig(cfg);

  assert.deepEqual(
    cfg.subagents.coding,
    {
      provider: "openai",
      name: "gpt-4o",
    },
  );

  assert.deepEqual(
    cfg.subagents.thinking,
    {
      provider: "deepseek",
      name: "deepseek-chat",
    },
  );

  assert.equal(
    cfg.subagents.bogus,
    undefined,
  );

  assert.deepEqual(
    Object.keys(cfg.subagents).sort(),
    ["coding", "thinking"],
  );
});

Metadata preservation

Projection must retain all "ModelConfig" metadata:

test("preserves model metadata", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
        temperature: 0.3,
        contextWindow: 64000,
        maxOutputTokens: 8192,
      },
    },
  };

  normalizeModelConfig(cfg);

  assert.deepEqual(
    cfg.model,
    cfg.models.default,
  );

  assert.deepEqual(
    cfg.subagents.thinking,
    cfg.models.default,
  );
});

Invalid authoritative default

test("invalid authoritative default does not become fallback", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "",
        name: "",
      },
      coding: {
        provider: "openai",
        name: "gpt-4o",
      },
    },
  };

  normalizeModelConfig(cfg);

  assert.equal(cfg.model, undefined);

  assert.deepEqual(
    cfg.subagents.coding,
    {
      provider: "openai",
      name: "gpt-4o",
    },
  );

  assert.equal(
    cfg.subagents.thinking,
    undefined,
  );
});

Missing default clears stale projection

test("clears stale model when no valid default exists", () => {
  const cfg: any = {
    models: {
      coding: {
        provider: "openai",
        name: "gpt-4o",
      },
    },
    model: {
      provider: "stale",
      name: "stale",
    },
  };

  normalizeModelConfig(cfg);

  assert.equal(cfg.model, undefined);

  assert.deepEqual(
    cfg.subagents.coding,
    {
      provider: "openai",
      name: "gpt-4o",
    },
  );
});

Invalid-but-present default blocks migration

test("invalid-but-present default blocks legacy migration", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "",
        name: "",
      },
    },
    model: {
      provider: "legacy",
      name: "legacy",
    },
  };

  normalizeModelConfig(cfg);

  assert.deepEqual(
    cfg.models.default,
    {
      provider: "",
      name: "",
    },
  );

  assert.equal(cfg.model, undefined);
});

Empty state

test("no model configuration leaves projections unset", () => {
  const cfg: any = {};

  normalizeModelConfig(cfg);

  assert.equal(cfg.model, undefined);
  assert.equal(cfg.subagents, undefined);
});

---

Step 2 — Centralize validity

Add a small internal predicate:

function isValidModelConfig(
  model: ModelConfig | undefined,
): model is ModelConfig {
  return Boolean(
    model?.provider &&
    model?.name,
  );
}

Use it consistently for migration and projection.

---

Step 3 — Implement normalization

Import all canonical types/constants from "schema.ts".

Do not redefine:

ModelTier
MODEL_SUBAGENT_TIERS
DerivedSubagentConfig

Implementation:

function cloneModelConfig(
  model: ModelConfig,
): ModelConfig {
  return { ...model };
}

export function normalizeModelConfig(
  config: Partial<AlixConfig>,
): void {
  /*
   * 1. Legacy migration.
   *
   * Presence is authoritative:
   * only models.default === undefined permits migration.
   */
  if (
    config.models?.default === undefined &&
    isValidModelConfig(config.model)
  ) {
    config.models = {
      ...(config.models ?? {}),
      default: cloneModelConfig(config.model),
    };
  }

  /*
   * 2. Deterministic default projection.
   *
   * Invalid/missing defaults clear stale model state.
   */
  const defaultModel = config.models?.default;

  config.model = isValidModelConfig(defaultModel)
    ? cloneModelConfig(defaultModel)
    : undefined;

  /*
   * 3. Deterministic subagent projection.
   *
   * Only canonical non-default tiers may exist.
   */
  const derived: DerivedSubagentConfig = {};

  if (config.models) {
    for (const tier of MODEL_SUBAGENT_TIERS) {
      const model =
        config.models[tier] ??
        defaultModel;

      if (isValidModelConfig(model)) {
        derived[tier] = cloneModelConfig(model);
      }
    }
  }

  config.subagents =
    Object.keys(derived).length > 0
      ? derived
      : undefined;
}

---

Step 4 — Wire into "loadConfig()"

After the final "mergeConfig()" result is produced and before "requireModel" validation:

normalizeModelConfig(result);

Update user-facing guidance to:

Example: alix models set-default deepseek deepseek-v4-flash

Do not make "loadConfig()" write the migrated configuration back to disk.

---

Step 5 — Verify

pnpm build
node --test dist/tests/config-loader.test.js

Expected: all existing and new tests pass.

---

Step 6 — Commit

git add src/config/loader.ts tests/config-loader.test.ts

git commit -m "feat(config): project canonical models in loader"

---

6. Task 3 — Pure Model Resolver

Files

Create:

src/config/model-resolver.ts
tests/config/model-resolver.test.ts

---

Contract

export function resolveModelConfig(
  config: AlixConfig,
  tier?: ModelTier,
): ModelConfig

The resolver:

- reads "config.models";
- never reads "config.model";
- never reads "config.subagents";
- never reads "modelProfile";
- never mutates the input;
- returns a defensive copy;
- accepts only canonical "ModelTier" values.

---

Step 1 — Tests

Test:

1. default resolution;
2. explicit tier;
3. missing tier fallback;
4. missing model failure;
5. no mutation;
6. metadata preservation;
7. defensive copy;
8. "isModelTier()" boundary behavior.

Example:

test("default tier returns models.default", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
    },
  };

  assert.deepEqual(
    resolveModelConfig(cfg),
    {
      provider: "deepseek",
      name: "deepseek-chat",
    },
  );
});

test("explicit tier wins over default", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
      coding: {
        provider: "openai",
        name: "gpt-4o",
      },
    },
  };

  assert.deepEqual(
    resolveModelConfig(cfg, "coding"),
    {
      provider: "openai",
      name: "gpt-4o",
    },
  );
});

test("missing tier falls back to default", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
    },
  };

  assert.deepEqual(
    resolveModelConfig(cfg, "critic"),
    {
      provider: "deepseek",
      name: "deepseek-chat",
    },
  );
});

test("throws when no model resolves", () => {
  assert.throws(
    () => resolveModelConfig({} as AlixConfig),
    /No model configured/,
  );
});

test("does not mutate input", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
      },
    },
  };

  const before = JSON.stringify(cfg);

  resolveModelConfig(cfg, "coding");

  assert.equal(
    JSON.stringify(cfg),
    before,
  );
});

test("returns full metadata as defensive copy", () => {
  const cfg: any = {
    models: {
      default: {
        provider: "deepseek",
        name: "deepseek-chat",
        temperature: 0.3,
        contextWindow: 64000,
      },
    },
  };

  const result = resolveModelConfig(cfg);

  assert.deepEqual(
    result,
    cfg.models.default,
  );

  assert.notEqual(
    result,
    cfg.models.default,
  );

  result.temperature = 999;

  assert.equal(
    cfg.models.default.temperature,
    0.3,
  );
});

Boundary test:

test("isModelTier rejects profile-only tiers", () => {
  assert.ok(isModelTier("coding"));
  assert.ok(isModelTier("default"));

  assert.ok(!isModelTier("coder"));
  assert.ok(!isModelTier("bogus"));
});

---

Step 2 — Implement

import type {
  AlixConfig,
  ModelConfig,
  ModelTier,
} from "./schema.js";

export function resolveModelConfig(
  config: AlixConfig,
  tier?: ModelTier,
): ModelConfig {
  const model =
    tier === undefined ||
    tier === "default"
      ? config.models?.default
      : config.models?.[tier] ??
        config.models?.default;

  if (!model?.provider || !model?.name) {
    throw new Error(
      "No model configured. Run: alix models set-default",
    );
  }

  return { ...model };
}

Do not add an unknown-tier check.

The type contract already guarantees legal tiers.

External strings must be validated by "isModelTier()" before calling the resolver.

---

Step 3 — Verify

pnpm build
node --test dist/tests/config/model-resolver.test.js

---

Step 4 — Commit

git add src/config/model-resolver.ts tests/config/model-resolver.test.ts

git commit -m "feat(config): add pure model resolver"

---

7. Task 4 — Shared Persistence Boundary

Files

Create:

src/config/persistence.ts
tests/config/persistence.test.ts

---

Contract

Every configuration writer must ultimately use:

withoutDerivedModelProjections()

and:

writeConfig()

---

Step 1 — Implement strip helper

import type {
  AlixConfig,
  PersistedAlixConfig,
} from "./schema.js";

export function withoutDerivedModelProjections(
  config: AlixConfig,
): PersistedAlixConfig {
  const {
    model: _model,
    subagents: _subagents,
    ...persisted
  } = config;

  return {
    ...persisted,
    __persistedConfigBrand:
      "PersistedAlixConfig",
  };
}

---

Step 2 — Implement the only write entrypoint

import { writeFile } from "node:fs/promises";

export async function writeConfig(
  config: PersistedAlixConfig,
  configPath: string,
): Promise<void> {
  const {
    __persistedConfigBrand: _brand,
    ...serializable
  } = config;

  await writeFile(
    configPath,
    JSON.stringify(
      serializable,
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

The brand exists only at the TypeScript boundary.

It must never appear in "config.json".

---

Step 3 — Tests

Test:

- stripping "model";
- stripping "subagents";
- preserving "models";
- preserving "modelProfile";
- preserving "apiKeys";
- compile-time rejection of raw "AlixConfig";
- actual serialized output.

The type test must include:

// @ts-expect-error
const invalid: PersistedAlixConfig = raw;

and:

const valid =
  withoutDerivedModelProjections(raw);

const persisted: PersistedAlixConfig =
  valid;

Also verify:

saved.model === undefined
saved.subagents === undefined
saved.models !== undefined

and:

saved.__persistedConfigBrand === undefined

---

Step 4 — Verify

pnpm build
node --test dist/tests/config/persistence.test.js

---

Step 5 — Commit

git add src/config/persistence.ts tests/config/persistence.test.ts

git commit -m "feat(config): enforce persisted config boundary"

---

8. Task 5 — Profile Writers

Files

Modify:

src/config/profile-patch.ts
tests/config/profile-patch.test.ts

---

8.1 "buildProfilePatch()"

The profile writer must produce:

{
  modelProfile,
  models
}

and never:

model
subagents

---

Profile mapping

Use only:

PROFILE_TIER_MAP

The mapping is:

default      → default
planner      → thinking
researcher   → fast
coder        → coding
critic       → critic
embeddings   → tiny
classifier   → undefined

"classifier" has no configuration tier and is skipped.

---

Metadata

Preserve:

- provider;
- name;
- temperature;
- contextWindow;
- any other explicitly supported "ModelConfig" metadata.

Do not reduce the projection to provider/name only.

---

8.2 "applyProfilePatch()"

Contract:

applyProfilePatch(
  existingConfig,
  patch,
): PersistedAlixConfig

It must:

1. remove stale "model";
2. remove stale "subagents";
3. preserve existing "models" tiers;
4. apply profile tiers;
5. let profile tiers win;
6. preserve "modelProfile";
7. preserve unrelated persisted configuration;
8. return a branded "PersistedAlixConfig".

Implementation shape:

export function applyProfilePatch(
  existingConfig: AlixConfig,
  patch: ProfilePatch,
): PersistedAlixConfig {
  const persisted =
    withoutDerivedModelProjections(
      existingConfig,
    );

  return {
    ...persisted,

    modelProfile:
      patch.modelProfile,

    models: {
      ...(persisted.models ?? {}),
      ...(patch.models ?? {}),
    },

    ...(patch.runtime
      ? {
          runtime: {
            ...(persisted.runtime ?? {}),
            ...patch.runtime,
          },
        }
      : {}),
  };
}

This is a partial profile patch, not a full replacement.

---

Tests

Patch contains only authoritative fields

test("buildProfilePatch writes only modelProfile + models", () => {
  const patch =
    buildProfilePatch(
      balancedLocalProfile,
    );

  assert.equal(
    patch.modelProfile,
    "balanced-local",
  );

  assert.ok(
    patch.models?.default,
  );

  assert.ok(
    patch.models?.coding,
  );

  assert.equal(
    patch.model,
    undefined,
  );

  assert.equal(
    patch.subagents,
    undefined,
  );
});

Stale projections removed

test("applyProfilePatch strips stale projections", () => {
  const existing = {
    model: {
      provider: "old",
      name: "old-model",
    },
    subagents: {
      coding: {
        provider: "old",
        name: "old-coder",
      },
    },
  };

  const result =
    applyProfilePatch(
      existing as AlixConfig,
      buildProfilePatch(
        balancedLocalProfile,
      ),
    );

  assert.equal(result.model, undefined);
  assert.equal(result.subagents, undefined);
  assert.ok(result.models?.default);
});

Existing tiers preserved

test("applyProfilePatch merges rather than replaces models", () => {
  const existing = {
    models: {
      default: {
        provider: "existing",
        name: "existing-default",
      },
      fast: {
        provider: "existing",
        name: "existing-fast",
      },
    },
  };

  const result =
    applyProfilePatch(
      existing as AlixConfig,
      buildProfilePatch(
        balancedLocalProfile,
      ),
    );

  assert.ok(result.models?.coding);

  assert.deepEqual(
    result.models?.fast,
    {
      provider: "existing",
      name: "existing-fast",
    },
  );
});

Disk invariant

Also drive the returned object through:

writeConfig()

and read it back.

Assert:

models present
model absent
subagents absent
modelProfile preserved
brand absent

---

Verify

pnpm build

node --test \
  dist/tests/config/profile-patch.test.js \
  dist/tests/config-loader.test.js \
  dist/tests/models/model-install.test.js

---

Commit

git add src/config/profile-patch.ts tests/config/profile-patch.test.ts

git commit -m "fix(config): persist profile models as authoritative configuration"

---

9. Task 6 — "alix models" Writers

Files

Modify:

src/cli/commands/models.ts
tests/cli/models-command.vitest.ts

---

Contract

The model command family owns model writes.

Required handlers:

alix models set-default
alix models set-tier <tier>

These write only:

models

They never persist:

model
subagents

---

"set-default"

Flow:

interactive provider selection
        ↓
API key
        ↓
available models
        ↓
model selection
        ↓
loadConfig()
        ↓
withoutDerivedModelProjections()
        ↓
merge models.default
        ↓
writeConfig()

Implementation:

const existing =
  await loadConfig(cwd);

const persisted =
  withoutDerivedModelProjections(
    existing,
  );

persisted.models = {
  ...(persisted.models ?? {}),
  default: selected,
};

await writeConfig(
  persisted,
  configPath,
);

Do not call "normalizeModelConfig()".

---

"set-tier"

Validate arbitrary CLI input first:

if (!isModelTier(tier)) {
  throw new Error(...);
}

Do not allow:

coder
planner
researcher

as configuration tiers.

Then:

persisted.models = {
  ...(persisted.models ?? {}),
  [tier]: selected,
};

"set-tier" must merge.

It must never replace:

models

wholesale.

---

Tests

Mock provider-selection.

Test that "set-default" writes:

{
  "models": {
    "default": {
      "provider": "deepseek",
      "name": "deepseek-chat"
    }
  }
}

and does not write:

{
  "model": ...
}

or:

{
  "subagents": ...
}

---

Merge test

Pre-seed:

{
  "models": {
    "default": {
      "provider": "deepseek",
      "name": "deepseek-chat"
    },
    "fast": {
      "provider": "existing",
      "name": "fast-model"
    }
  },
  "model": {
    "provider": "stale",
    "name": "stale"
  },
  "subagents": {
    "thinking": {
      "provider": "stale",
      "name": "stale"
    }
  }
}

Run:

alix models set-tier coding

Assert:

models.default preserved
models.fast preserved
models.coding added
model removed
subagents removed

Also assert "modelProfile" survives.

---

Verify

npx vitest run tests/cli/models-command.vitest.ts

---

Commit

git add src/cli/commands/models.ts tests/cli/models-command.vitest.ts

git commit -m "feat(models): persist model assignments under models only"

---

10. Task 7 — Remove Legacy Model Commands

Files

Modify:

src/cli.ts
tests/cli/cli-commands.test.ts

---

Removed commands

Delete:

alix config set-default-model
alix config set-tier

Do not leave aliases.

Do not leave compatibility dispatch.

Do not leave usage documentation claiming they exist.

---

Behavioral test

The test must execute the real CLI dispatch.

Legacy:

config set-default-model
config set-tier

must fail as unknown/unrecognized commands.

New:

models set-default
models set-tier

must not be classified as unknown commands.

Do not couple the new-command test to interactive TTY behavior.

---

Test implementation

Use the repository's existing CLI subprocess helper if one exists.

Otherwise execute the built CLI using "execFileSync".

For legacy commands assert:

exit !== 0

and output matches:

unknown command

or equivalent project wording.

For new commands, assert only:

not unknown command

because interactive completion may legitimately terminate differently in a non-TTY test environment.

---

Search after removal

rg 'set-default-model|config set-tier' src tests

Any remaining occurrence must be intentional test documentation or historical context.

---

Verify

pnpm build
node --test dist/tests/cli/cli-commands.test.js

---

Commit

git add src/cli.ts tests/cli/cli-commands.test.ts

git commit -m "feat(cli): remove legacy model configuration commands"

---

11. Task 8 — Migrate Runtime Readers

Files

Modify:

src/agent/agent.ts
src/agent/session.ts
src/run/task-loop.ts
src/agents/subagent-cli.ts

---

11.1 General rule

Replace runtime model resolution based on:

config.model
config.subagents

with:

resolveModelConfig(
  config,
  tier?,
)

New runtime code must never make compatibility projections authoritative.

---

11.2 "agent.ts"

Replace direct:

config.model.provider
config.model.name

with:

const {
  provider,
  name,
} = resolveModelConfig(config);

---

11.3 "session.ts"

Replace model provider/name reads with:

const model =
  resolveModelConfig(config);

Keep legitimate "ModelConfig" metadata such as:

model.streaming

where required.

Do not mutate:

config.model

---

11.4 "task-loop.ts"

Replace default model resolution with:

resolveModelConfig(config)

Do not use:

config.model

as an authoritative model source.

---

11.5 "subagent-cli.ts"

This site is precedence-sensitive.

The required precedence is:

explicit invocation override
        >
models.<tier>
        >
models.default

The override must not mutate:

config.model

or:

config.subagents

Tier lookup must use:

resolveModelConfig(
  config,
  tier,
)

---

Required test

Create a test that proves:

models.default
models.coding
explicit --model override

resolve in this order:

override > coding > default

and that resolving the override does not modify:

config.model

---

Verify

pnpm build

node --test \
  dist/tests/config-loader.test.js \
  dist/tests/config/model-resolver.test.js \
  dist/tests/config/profile-patch.test.js \
  dist/tests/models/model-install.test.js \
  dist/tests/agent/agent-loop.test.js \
  dist/tests/agent/session.test.js

---

Commit

git add \
  src/agent/agent.ts \
  src/agent/session.ts \
  src/run/task-loop.ts \
  src/agents/subagent-cli.ts

git commit -m "refactor(config): resolve runtime models from canonical models"

---

12. Task 9 — Cross-Cutting Single-Source Invariant Suite

File

Create:

tests/config/model-invariant.test.ts

This is the final architecture contract.

Local tests verify individual functions.

This suite verifies that the entire model-configuration lifecycle still obeys the single-source architecture.

---

12.1 Final writer audit — hard gate

Before writing the tests, run:

rg '(\.model|\.subagents|\["model"\]|\["subagents"\])\s*=' src \
  --glob '!**/*.test.*'

Then:

rg 'model:|subagents' src/cli/commands src/models src/config \
  --glob '!**/*.test.*'

Then:

rg 'writeFile|writeJson|saveConfig|save.*Config|updateConfig|mergeConfig' src \
  --glob '!**/*.test.*'

Every writer must be classified as:

1. persistence of "models";
2. persistence of unrelated configuration;
3. loader projection;
4. runtime reader;
5. profile mapping;
6. another explicitly approved non-model use.

If any writer independently persists model state under:

model
subagents

STOP.

Do not mark the task complete.

---

12.2 Profile persistence invariant

Drive the real profile path through persistence.

Assert:

models present
modelProfile present
model absent
subagents absent

---

12.3 "set-default" persistence invariant

Drive the real handler.

Read the resulting JSON.

Assert:

models.default exists
model absent
subagents absent

---

12.4 "set-tier" persistence invariant

Drive the real handler.

Assert:

models.<tier> exists
models.default preserved
other models tiers preserved
model absent
subagents absent

---

12.5 Loader migration invariant

Given:

{
  "model": {
    "provider": "legacy",
    "name": "legacy-model"
  }
}

run:

const before =
  readFileSync(
    configPath,
    "utf8",
  );

const config =
  await loadConfig(cwd);

Assert runtime:

config.models.default
config.model
config.subagents.thinking
config.subagents.coding
config.subagents.fast
config.subagents.critic
config.subagents.tiny
config.subagents.image

Then read disk again and assert:

after === before

This is the highest-value migration test.

It proves both halves of the contract:

runtime migration happened
+
disk migration did NOT happen

---

12.6 Default precedence invariant

Test:

legacy model = A
models.default = B

After normalization:

models.default = B
model = B

---

12.7 Tier precedence invariant

Test:

models.default = A
models.coding = B

After normalization:

subagents.coding = B
subagents.thinking = A

---

12.8 Invalid-default invariant

Test:

models.default = invalid
models.coding = valid
legacy model = valid

Assert:

models.default remains invalid
model is undefined
subagents.coding resolves
subagents.thinking is undefined

This ensures an invalid authoritative default doesn't silently become a fallback source.

---

12.9 Resolver purity invariant

Test that:

resolveModelConfig()

does not mutate:

models
model
subagents
modelProfile

and does not consult "modelProfile".

---

12.10 Defensive-copy invariant

Verify that:

const resolved =
  resolveModelConfig(config);

resolved.temperature = 999;

does not mutate:

config.models.default.temperature

---

13. Task 10 — Full Verification

Run:

pnpm build

Then:

node --test \
  dist/tests/config-loader.test.js \
  dist/tests/config/model-resolver.test.js \
  dist/tests/config/persistence.test.js \
  dist/tests/config/profile-patch.test.js \
  dist/tests/models/model-install.test.js \
  dist/tests/config/model-invariant.test.js \
  dist/tests/cli/cli-commands.test.js

Then:

npx vitest run tests/cli/models-command.vitest.ts

Then the complete suites:

pnpm test:vitest
pnpm test:node

No new failures are permitted.

Known pre-existing failures may remain only if they are byte-identical to the baseline and documented before this implementation.

---

14. Manual Verification

After successful tests, manually verify:

Active model

alix config show

The active model should still render correctly.

---

Set default

alix models set-default

Inspect "config.json".

Expected:

{
  "models": {
    "default": {
      "provider": "...",
      "name": "..."
    }
  }
}

No independent:

"model": ...

No:

"subagents": ...

---

Set tier

alix models set-tier coding

Verify:

models.default preserved
models.coding written
other models tiers preserved
model absent
subagents absent

---

Legacy command

alix config set-default-model

Expected:

unknown command

Likewise:

alix config set-tier

---

15. GitNexus / Repository Impact Checks

Before modifying high-impact functions, follow the repository's existing GitNexus workflow.

At minimum:

loadConfig
mergeConfig
buildProfilePatch
applyProfilePatch
handleModelsCommand

Run:

detect_changes()

before each commit where required by "CLAUDE.md".

Run:

impact()

for high-impact changes before editing them.

Do not skip repository-specific engineering instructions.

---

16. Commit Sequence

Use conventional commits.

Recommended sequence:

feat(config): define canonical model tier vocabulary

feat(config): project canonical models in loader

feat(config): add pure model resolver

feat(config): enforce persisted config boundary

fix(config): persist profile models as authoritative configuration

feat(models): persist model assignments under models only

feat(cli): remove legacy model configuration commands

refactor(config): resolve runtime models from canonical models

test(config): enforce single-source model invariants

Do not use:

Spec:
Plan:
plan:

or other non-conventional prefixes.

---

17. Final Architecture Checklist

Before declaring the implementation complete, every statement below must be true.

Persistence

- [ ] "models" is the only persisted model-selection authority.
- [ ] "modelProfile" is persisted only as provenance/metadata.
- [ ] "apiKeys" remains independent.
- [ ] "model" is never persisted by a model writer.
- [ ] "subagents.*" is never persisted by a model writer.
- [ ] The persistence API accepts only "PersistedAlixConfig".
- [ ] Raw "AlixConfig" is rejected by the persistence API at compile time.
- [ ] The persistence brand never appears on disk.

Loading

- [ ] "loadConfig()" performs in-memory migration.
- [ ] Legacy migration never rewrites "config.json".
- [ ] "models.default" wins whenever the property exists.
- [ ] Legacy "model" migrates only when "models.default === undefined".
- [ ] Legacy migration requires a valid provider/name pair.
- [ ] "model" is derived exclusively from "models.default".
- [ ] "subagents" is derived exclusively from "models".
- [ ] Stale projection keys are removed.
- [ ] Metadata survives projection.
- [ ] Empty model configuration does not manufacture "subagents: {}".

Resolution

- [ ] "resolveModelConfig()" reads "models" only.
- [ ] "resolveModelConfig()" knows nothing about "modelProfile".
- [ ] "resolveModelConfig()" never mutates config.
- [ ] "resolveModelConfig()" returns a defensive copy.
- [ ] Explicit tiers override default.
- [ ] Missing tiers fall back to default.
- [ ] Invalid authoritative default does not become a fallback.
- [ ] Unknown strings are rejected at the external boundary by "isModelTier()".

Tier vocabulary

- [ ] "ModelTier" is closed.
- [ ] "MODEL_TIER_VALUES" is canonical.
- [ ] "MODEL_SUBAGENT_TIERS" contains exactly the six non-default tiers.
- [ ] "coder" is not a configuration tier.
- [ ] Profile "coder" maps to configuration "coding".
- [ ] Profile vocabulary is distinct from configuration vocabulary.
- [ ] "PROFILE_TIER_MAP" is typed against both vocabularies.

Writers

- [ ] "alix models set-default" writes only "models.default".
- [ ] "alix models set-tier" writes only "models.<tier>".
- [ ] "set-tier" merges rather than replaces "models".
- [ ] Profile application merges rather than replaces "models".
- [ ] Profile application strips stale projections.
- [ ] Writers never call "normalizeModelConfig()".
- [ ] Writers use the shared persistence boundary.

Runtime

- [ ] New runtime code uses "resolveModelConfig()".
- [ ] Runtime code does not use "config.model" as authoritative state.
- [ ] Runtime code does not use "config.subagents" as authoritative state.
- [ ] "subagent-cli" preserves explicit override precedence.
- [ ] Model resolution does not mutate compatibility projections.

CLI

- [ ] "config set-default-model" is removed.
- [ ] "config set-tier" is removed.
- [ ] Legacy commands fail as unknown commands through actual dispatch.
- [ ] "models set-default" is registered.
- [ ] "models set-tier" is registered.

Testing

- [ ] Loader migration is tested byte-for-byte on disk.
- [ ] Invalid-but-present default semantics are tested.
- [ ] Metadata preservation is tested.
- [ ] Defensive-copy behavior is tested.
- [ ] Profile persistence is tested on disk.
- [ ] "set-default" persistence is tested on disk.
- [ ] "set-tier" persistence is tested on disk.
- [ ] Cross-cutting invariant suite exists.
- [ ] Final writer audit is clean.
- [ ] Full Node test suite passes without new failures.
- [ ] Full Vitest suite passes without new failures.
- [ ] Build passes.
- [ ] Manual CLI behavior is verified.

---

18. Definition of Done

This work is complete only when the following statement is true:

«There is exactly one persistent source of model assignments ("models"), exactly one loader-owned projection boundary ("loadConfig()"), exactly one runtime resolution API ("resolveModelConfig()"), and exactly one persistence safety boundary ("writeConfig(PersistedAlixConfig)").»

The compatibility fields:

model
subagents.*

may exist in memory for existing consumers, but they cannot:

1. establish persistent model state;
2. override "models";
3. participate in new runtime resolution;
4. be written independently;
5. survive a persistence boundary.

The resulting lifecycle is therefore:

                    ┌───────────────┐
                    │ config.json   │
                    │               │
                    │ models        │
                    │ modelProfile  │
                    └───────┬───────┘
                            │
                            ▼
                       loadConfig()
                            │
                  ┌─────────┴─────────┐
                  │                   │
                  ▼                   ▼
               models              projections
             authoritative       model/subagents
                  │                   │
                  └─────────┬─────────┘
                            │
                            ▼
                 resolveModelConfig()
                            │
                            ▼
                         runtime


Runtime/config mutation
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

That is the architectural invariant this implementation must leave behind.