# Claim-Verification Shadow Tool Implementation Plan

**Status:** shipped — merged as PR #824 (8 tasks, 15 commits; final review fixes applied)

**Spec:** `docs/superpowers/specs/2026-09-22-claim-verification-shadow-tool-design.md` (approved; amendments §3.1)

**Goal:** Give the agent a usable `alix_verify_claim` primitive over inline evidence, with Jev observable behind it in `shadow` mode so real journal records make the experiment gate (§20) computable.

**Architecture:** Add the missing `selection-service.ts` to claim-verification (the only decision of four without one), a thin tool handler + router on top of it, a local protected experiment projection store for blind labelling, and two `alix jev` subcommands (`disagreements`, `label-pair`). `baseline` mode is a pure local call; `shadow` journals both engines under one `projectionHash` and returns the baseline verdict; `active` returns the configured engine's verdict. Nothing gains execution authority (`authority: "none"` everywhere).

**Tech Stack:** TypeScript, Node's built-in `node:test`, existing `JsonlStore`/journal/calibration primitives. No new dependencies. Build with `pnpm build` (compiles `dist/`), then run tests with `node --test dist/tests/<file>.test.js`.

## Global Constraints

Values copied verbatim from the spec; every task inherits them.

- `mode` enum is exactly `"baseline" | "shadow" | "active"`; default `"baseline"` (spec §3.1 amendment — originally `off`, renamed because the tool stays functional locally).
- Evidence bounds come from `projection.ts` and are **never hardcoded**: `MAX_CLAIM_CHARS` (2000), `MAX_EVIDENCE_ITEMS` (8), `MAX_EXCERPT_CHARS` (1200).
- Model-facing payload is exactly `{ verdict, engine, decisionId?, authority: "none", warning? }`. Never expose `agree`, the baseline's verdict, latency, promotion state, or the tally (spec §8.3).
- Experiment store: `~/.alix/decisions/experiments.jsonl`, resolved as `join(storeDir ?? join(homedir(), ".alix"), "decisions", "experiments.jsonl")`, written with shared `JsonlStore` (spec §16.4). Never a hardcoded `~` literal.
- Policy key `verify.claim` must resolve as itself — never `tool.invoke`, which falls through to `permissions.default = "ask"` (approval prompt per call, spec §7.1).
- Endpoint only via `JEV_SYSTEMONE_ENDPOINT`; key store-only at provider id `typesafe` (spec §23).
- Inline excerpts only: the tool performs no URL/path fetching, no browser access (spec §3).
- Experiment gate (informational in the CLI footer, **not enforced in code**): ≥30 comparable pairs, ≥10 labelled disagreements, ≥70% Jev win rate; tie → baseline (spec §20).
- Do not modify the model-tier, risk-escalation, or context-relevance selection services (spec §8).
- Stage **explicit paths only** — never `git add -u <dir>` (a directory-wide add previously swept unrelated work into a commit).
- One commit per task. Run `pnpm build` before every test run.
- Never `git add` a `.js` under `dist/` — build output is gitignored (caught during self-review; stage `.ts` sources and `.ts` tests only).
- **Preflight first:** create `feat/claim-verification-shadow-tool` before Task 1 — one-commit-per-task only helps if every commit lands on that branch (plan amendment 3).
- **Experiment pairs are exactly Jev + local baseline** (`JEV_ENGINE_ID` + `LOCAL_ENGINE_ID`). Any third engine may be journaled but never enters `paired`, `disagreementRate`, `bothWrong`, or a `label-pair` write (plan amendment 2).
- **`label-pair` is claim-verification only** in this phase — other decisions have no protected projection store, so §18.4's projection refusal would fire regardless (plan amendment 4).
- **Blind labelling is genuinely two-stage:** no verdict direction appears in any output the operator sees before truth is entered. `--truth` exists only as the documented non-interactive path where the caller already established truth independently (plan amendment 1).

## Verification Commands

```bash
pnpm build
node --test dist/tests/config/decision-section.test.js
node --test dist/tests/decision/claim-verification.test.js
node --test dist/tests/tools/capability-map.test.js dist/tests/tools/tool-registry.test.js
node --test dist/tests/tools/claim-verification-tool.test.js
node --test dist/tests/cli/jev-ops.test.js
pnpm test:vitest tests/tools/tool-contract.vitest.ts tests/tools/taxonomy-sentinel.vitest.ts
pnpm typecheck:unused
pnpm check:dead
```

## File Structure

| File | Responsibility | New / Modify |
|------|----------------|--------------|
| `src/decision/config.ts` | `DecisionMode` values + `mode?` on `DecisionRoutePolicy` + default `"baseline"` | Modify |
| `src/config/validator.ts` | Reject unknown `mode` with its path | Modify |
| `src/decision/decisions/claim-verification/selection-service.ts` | `selectClaimVerification` (`baseline`/`shadow`/`active`) | Create |
| `src/decision/decisions/claim-verification/index.ts` | Export the selection service | Modify |
| `src/decision/decisions/claim-verification/experiment-store.ts` | Protected projection store (`JsonlStore`, `storeDir` override) | Create |
| `src/decision/paths.ts` | `resolveDecisionPaths(cwd)` — journal/fixture/profile paths, decision-owned so tools never import `cli/commands` | Create |
| `src/decision/engines/jev.ts` | Host `JEV_KEY_PROVIDER_ID` (moved from `cli/commands/jev/ops.ts`) | Modify |
| `src/decision/decisions/claim-verification/shadow.ts` | Expose `projection` (the sealed payload) on the shadow result | Modify |
| `src/tools/claim-verification-tool.ts` | `handleClaimVerify`: validation, modes, degradation, payload | Create |
| `src/tools/tool-router.ts` | `ClaimVerificationToolRouter` (lazy import, `StateToolRouter` pattern) | Modify |
| `src/tools/tool-registry.ts` | `ToolCapability` entry + `"decision"` domain | Modify |
| `src/tools/executor.ts` | Register the router | Modify |
| `src/config/defaults.ts` | `permissions.tools["verify.claim"] = "allow"` | Modify |
| `src/run/helpers.ts` | `BASE_TOOLS` manifest entry `alix_verify_claim` | Modify |
| `src/agents/tool-name-map.ts` | `alix_verify_claim → verify.claim` | Modify |
| `src/agent/agent-loop.ts` | `readOnlyToolFilter.add("alix_verify_claim")` | Modify |
| `src/cli/commands/jev/ops.ts` | `buildDisagreements` + `labelPair` + shared grouping; re-export moved paths/key id | Modify |
| `src/cli/commands/jev/render.ts` | `renderDisagreements` / `renderLabelPair` | Modify |
| `src/cli/commands/jev/main.ts` | Two new subcommands + usage line | Modify |
| `tests/config/decision-section.test.ts` | mode default/merge/reject | Modify |
| `tests/decision/claim-verification.test.ts` | mode behaviour incl. shadow-divergence pin | Modify |
| `tests/tools/capability-map.test.ts` | approval-trap pin, registry entry, manifest, alias, permission | Modify |
| `tests/tools/claim-verification-tool.test.ts` | handler: validation, payload, degradation, warnings | Create |
| `tests/cli/jev-ops.test.ts` | disagreements + label-pair | Modify |

Note on capability-map: no source edit is required there — `inferCapability` is *derived* from the registry, so the registry entry in Task 5 supplies the policy key. The test pins that derivation.

---

## Preflight — do this BEFORE Task 1 (plan amendment 3)

Tasks 1–7 each commit; those commits must land on the feature branch, not on
whatever happened to be checked out when execution started.

- [ ] **Step 0.1: Land the docs first, so the feature branch carries the spec and plan**

Run: `gh pr merge 823 --merge`
Expected: merged (the spec and plan are approved). Skip only if already merged.

- [ ] **Step 0.2: Create the feature branch**

```bash
git status --short      # tracked tree must be clean (untracked .tmp/ etc. is fine)
git fetch origin
git switch -c feat/claim-verification-shadow-tool origin/main
git log --oneline -1    # expect the #823 merge commit
```

Expected: on `feat/claim-verification-shadow-tool`, based on merged `main`.

---

### Task 1: Decision route `mode` config field

**Files:**
- Modify: `src/decision/config.ts`
- Modify: `src/config/validator.ts`
- Test: `tests/config/decision-section.test.ts`

**Interfaces:**
- Produces: `DECISION_MODE_VALUES` (`["baseline","shadow","active"]` as const), `DecisionMode`, `DecisionRoutePolicy.mode?: DecisionMode`, `DEFAULT_DECISION_CONFIG.claimVerification.mode === "baseline"`. Task 2+ read `mode` from this route.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("decision config section", ...)` in `tests/config/decision-section.test.ts`:

```ts
  it("claimVerification.mode defaults to baseline and accepts a valid mode", () => {
    assert.equal(DEFAULT_DECISION_CONFIG.claimVerification.mode, "baseline");
    const merged = mergeConfig(DEFAULT_CONFIG, {
      decision: {
        claimVerification: { engine: "jev", fallback: "local", thresholdProfile: "t/v1", mode: "shadow" },
      },
    });
    assert.equal(merged.decision?.claimVerification?.mode, "shadow");
    assert.equal(validateConfig(merged).valid, true);
  });

  it("rejects an unknown claimVerification.mode with its path", () => {
    const bad = {
      ...MINIMAL_CONFIG,
      decision: { claimVerification: { mode: "enabled" } },
    } as unknown as AlixConfig;
    const result = validateConfig(bad);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === "decision.claimVerification.mode"));
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/config/decision-section.test.js`
Expected: FAIL — `undefined !== "baseline"` (the `mode` property does not exist yet).

- [ ] **Step 3: Implement**

In `src/decision/config.ts`, above `DecisionRoutePolicy`:

```ts
/** Claim-verification experiment seam (spec §6). Original draft said "off";
 *  renamed to "baseline" because the tool stays functional locally (§3.1). */
export const DECISION_MODE_VALUES = ["baseline", "shadow", "active"] as const;
export type DecisionMode = (typeof DECISION_MODE_VALUES)[number];
```

Change `DecisionRoutePolicy` to add the field:

```ts
export type DecisionRoutePolicy = {
  engine: string;
  fallback: string;
  thresholdProfile: string;
  enabled?: boolean;
  mode?: DecisionMode;
};
```

In `DEFAULT_DECISION_CONFIG.claimVerification`, add `mode: "baseline",`.

In `src/config/validator.ts`, inside the decision block's route loop (the `for … const route = decision[key]` loop), after the `enabled` check:

```ts
if (route.mode !== undefined && !(DECISION_MODE_VALUES as readonly unknown[]).includes(route.mode)) {
  issues.push({
    path: `decision.${key}.mode`,
    level: "error",
    message: `mode must be one of ${DECISION_MODE_VALUES.join("|")}`,
  });
}
```

Add the import: `import { DECISION_MODE_VALUES } from "../decision/config.js";` (type-free value import; `decision/config.ts` imports only `./contracts.js` types, so no cycle).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm build && node --test dist/tests/config/decision-section.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/decision/config.ts src/config/validator.ts tests/config/decision-section.test.ts
git commit -m "feat(decision): add route mode field (baseline|shadow|active)"
```

---

### Task 2: `selectClaimVerification` selection service

**Files:**
- Create: `src/decision/decisions/claim-verification/selection-service.ts`
- Modify: `src/decision/decisions/claim-verification/index.ts` (add `export * from "./selection-service.js";`)
- Test: `tests/decision/claim-verification.test.ts`

**Interfaces:**
- Consumes (all already exported via `src/decision/index.js`): `runClaimVerificationShadow`, `ClaimVerificationShadowDeps`, `classifyClaimLocally`, `createClaimVerificationProjector`, `LOCAL_ENGINE_ID`, `JEV_ENGINE_ID`, `DEFAULT_DECISION_CONFIG`, `createDefaultRegistry`, `createDecisionJournalStore`, `registerJevEngine`, `createJevExecutor`, `JevTransport`.
- Produces: `ClaimSelectionMode = "baseline" | "shadow" | "active"`, `ClaimSelection = { mode, verdict?, engineId?, shadow? }`, `selectClaimVerification(input, deps): Promise<ClaimSelection>`. Task 4 is the only consumer.

- [ ] **Step 1: Write the failing tests**

Append to `tests/decision/claim-verification.test.ts` (the file already imports `mkdtempSync`/`rmSync`/`tmpdir`/`join`, `before`/`after`, `createDefaultRegistry`, `registerJevEngine`, `createDecisionJournalStore`, `runClaimVerificationShadow`, `JEV_ENGINE_ID`, `LOCAL_ENGINE_ID`; also add `selectClaimVerification` to its `src/decision/index.js` import list after Step 3 compiles):

```ts
describe("selectClaimVerification modes", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-select-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const input = {
    claim: "Water boils at 100 degrees Celsius at sea level.",
    evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }],
  };

  it("baseline mode: local verdict, no journal records, no shadow observation", async () => {
    const journal = createDecisionJournalStore(dir);
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry: createDefaultRegistry(),
      journal,
      mode: "baseline",
    });
    assert.equal(selection.mode, "baseline");
    assert.equal(selection.verdict, "supported");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.equal(selection.shadow, undefined);
    assert.equal(journal.readAll().length, 0);
  });

  it("shadow mode returns the BASELINE verdict while journalling both engines", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(dir);
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "shadow",
    });
    // The documented divergence (spec §10): shadow DOES return a verdict,
    // and it is the baseline's — behaviour unchanged, observation added.
    assert.equal(selection.verdict, "supported");
    assert.equal(selection.engineId, LOCAL_ENGINE_ID);
    assert.equal(selection.shadow?.observed.verdict, "contradicted");
    assert.equal(selection.shadow?.agree, false);
    const records = journal.readAll();
    assert.equal(records.length, 2);
    assert.equal(new Set(records.map((r) => r.projectionHash)).size, 1);
  });

  it("active mode returns the observed engine's verdict, still journalling both", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(dir);
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "active",
    });
    assert.equal(selection.verdict, "contradicted");
    assert.equal(selection.engineId, JEV_ENGINE_ID);
    assert.equal(journal.readAll().length, 2);
  });

  it("remote outage in shadow: verdict still returned, no usable pair", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      transport: async () => {
        throw new Error("network down");
      },
    });
    const journal = createDecisionJournalStore(dir);
    const selection = await selectClaimVerification(input, {
      config: jevConfig(),
      registry,
      journal,
      mode: "shadow",
    });
    assert.equal(selection.verdict, "supported");
    const choiceRecords = journal.readAll().filter((r) => r.outcome.kind === "choice");
    assert.ok(choiceRecords.length <= 1, "no comparable pair when the remote degraded");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/decision/claim-verification.test.js`
Expected: FAIL — `selectClaimVerification is not a function` / missing export.

- [ ] **Step 3: Implement**

Create `src/decision/decisions/claim-verification/selection-service.ts`:

```ts
/**
 * selection-service.ts — Claim-verification selection behind a feature flag.
 *
 * Modes:
 *  - "baseline" — deterministic local verdict; no engine plan, no journal,
 *    no network. Default, so the tool is useful before any experiment starts.
 *  - "shadow"   — run configured engine + local baseline over one sealed
 *    projection, journal both, return the BASELINE verdict.
 *  - "active"   — same observation, return the CONFIGURED engine's verdict.
 *
 * DIVERGENCE (deliberate, spec §10): selectModelTier/selectRiskTier return no
 * verdict in "shadow" because routing and PolicyGate already supply the
 * answer. Here the tool's entire response IS the verdict, so "shadow" must
 * return one — the baseline's, which is exactly "behaviour unchanged".
 * Observation begins; influence does not.
 */
import type { ClaimVerdict } from "./schema.js";
import { createClaimVerificationProjector, type ClaimVerificationInput } from "./projection.js";
import { classifyClaimLocally } from "./local-baseline.js";
import type { ClaimVerificationShadowDeps, ClaimVerificationShadowResult } from "./shadow.js";
import { runClaimVerificationShadow } from "./shadow.js";
import { LOCAL_ENGINE_ID } from "../../engines/local.js";

export type ClaimSelectionMode = "baseline" | "shadow" | "active";

export type ClaimSelection = {
  mode: ClaimSelectionMode;
  /** The verdict the consumer should use; absent only if no engine produced one. */
  verdict?: ClaimVerdict;
  /** Engine that produced `verdict`. */
  engineId?: string;
  /** Present in shadow/active; carries both records, `agree`, and `projection`. */
  shadow?: ClaimVerificationShadowResult;
};

export async function selectClaimVerification(
  input: ClaimVerificationInput,
  deps: ClaimVerificationShadowDeps & { mode?: ClaimSelectionMode },
): Promise<ClaimSelection> {
  const mode = deps.mode ?? "baseline";
  if (mode === "baseline") {
    const projection = createClaimVerificationProjector().project(input);
    const { verdict } = classifyClaimLocally(projection);
    return { mode, verdict, engineId: LOCAL_ENGINE_ID };
  }

  const shadow = await runClaimVerificationShadow(input, deps);

  if (mode === "shadow") {
    const verdict = shadow.baseline?.verdict ?? shadow.observed.verdict;
    return {
      mode,
      ...(verdict !== undefined
        ? { verdict, engineId: shadow.baseline?.engineId ?? LOCAL_ENGINE_ID }
        : {}),
      shadow,
    };
  }

  return {
    mode,
    ...(shadow.observed.verdict !== undefined
      ? { verdict: shadow.observed.verdict, engineId: shadow.observed.engineId }
      : {}),
    shadow,
  };
}
```

Add `export * from "./selection-service.js";` to `src/decision/decisions/claim-verification/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm build && node --test dist/tests/decision/claim-verification.test.js`
Expected: PASS — all tests including the new `selectClaimVerification modes` block (the shadow-divergence test fails until the `shadow` return exists).

- [ ] **Step 5: Commit**

```bash
git add src/decision/decisions/claim-verification/selection-service.ts src/decision/decisions/claim-verification/index.ts tests/decision/claim-verification.test.ts
git commit -m "feat(decision): add selectClaimVerification (baseline|shadow|active)"
```

---

### Task 3: Protected experiment projection store

**Files:**
- Create: `src/decision/decisions/claim-verification/experiment-store.ts`
- Modify: `src/decision/decisions/claim-verification/index.ts` (export it)
- Test: `tests/decision/claim-verification.test.ts`

**Interfaces:**
- Consumes: `JsonlStore` (`appendRecord`, `readRecords`) from `src/storage/jsonl-store.js`, `homedir()` from `node:os`.
- Produces: `ClaimVerificationExperimentProjection`, `EXPERIMENTS_FILE = "experiments.jsonl"`, `experimentStorePath(storeDir?)`, `createExperimentProjectionStore(storeDir?): { path, append, has, readByHash }`. Task 4 writes; Task 7 reads.

- [ ] **Step 1: Write the failing tests**

Append to `tests/decision/claim-verification.test.ts`:

```ts
describe("protected experiment projection store", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cv-experiments-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const record = (hash: string) => ({
    projectionHash: hash,
    decision: "claim-verification" as const,
    claim: "Water boils at 100 degrees Celsius at sea level.",
    evidence: [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }],
    createdAt: "2026-09-22T00:00:00.000Z",
  });

  it("resolves ~/.alix/decisions/experiments.jsonl through storeDir, never a bare ~", () => {
    assert.equal(experimentStorePath("/home/u/.alix"), join("/home/u/.alix", "decisions", "experiments.jsonl"));
    const real = experimentStorePath();
    assert.ok(real.endsWith(join(".alix", "decisions", "experiments.jsonl")), real);
    assert.equal(real.includes("~"), false);
  });

  it("round-trips a record and answers has/readByHash", async () => {
    const store = createExperimentProjectionStore(join(dir, ".alix"));
    assert.equal(await store.has("sha256:a"), false);
    await store.append(record("sha256:a"));
    assert.equal(await store.has("sha256:a"), true);
    assert.equal((await store.readByHash("sha256:a"))?.claim, record("sha256:a").claim);
    assert.equal(await store.readByHash("sha256:missing"), undefined);
  });
});
```

Add `createExperimentProjectionStore`, `experimentStorePath` to the file's `src/decision/index.js` import list (available once Step 3 exports them).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/decision/claim-verification.test.js`
Expected: FAIL — `experimentStorePath is not a function`.

- [ ] **Step 3: Implement**

Create `src/decision/decisions/claim-verification/experiment-store.ts`:

```ts
/**
 * experiment-store.ts — protected experiment projection store (spec §16).
 *
 * The journal deliberately keeps only `projectionHash` (JEV-2: never persist
 * payload), but an operator cannot establish ground truth from a hash alone.
 * This store keeps the SEALED (post-redaction) projection that was actually
 * evaluated, so `label-pair` can show claim + evidence before truth entry.
 *
 * User-scoped by design — see §16.4: the journal is project-scoped
 * (`{cwd}/.alix/decisions/decisions.jsonl`) while retained evidence lives
 * outside every repository and answers to one user-level retention policy.
 * Resolve via `storeDir ?? join(homedir(), ".alix")`: the same convention as
 * `src/config/calibration-store.ts`. Never hardcode `~`.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { JsonlStore } from "../../../storage/jsonl-store.js";

export type ClaimVerificationExperimentProjection = {
  projectionHash: string;
  decision: "claim-verification";
  claim: string;
  evidence: Array<{ source?: string; excerpt: string }>;
  createdAt: string;
};

export const EXPERIMENTS_FILE = "experiments.jsonl";

/** Canonical: `~/.alix/decisions/experiments.jsonl` (spec §16.4). */
export function experimentStorePath(storeDir?: string): string {
  return join(storeDir ?? join(homedir(), ".alix"), "decisions", EXPERIMENTS_FILE);
}

function isExperimentProjection(value: unknown): value is ClaimVerificationExperimentProjection {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectionHash === "string" &&
    record.decision === "claim-verification" &&
    typeof record.claim === "string" &&
    Array.isArray(record.evidence) &&
    typeof record.createdAt === "string"
  );
}

export type ExperimentProjectionStore = {
  path: string;
  append(record: ClaimVerificationExperimentProjection): Promise<void>;
  has(projectionHash: string): Promise<boolean>;
  readByHash(projectionHash: string): Promise<ClaimVerificationExperimentProjection | undefined>;
};

export function createExperimentProjectionStore(storeDir?: string): ExperimentProjectionStore {
  const store = new JsonlStore(experimentStorePath(storeDir));
  async function all(): Promise<ClaimVerificationExperimentProjection[]> {
    const { records } = await store.readRecords(isExperimentProjection);
    return records;
  }
  return {
    path: store.filePath,
    async append(record) {
      await store.appendRecord(record);
    },
    async has(projectionHash) {
      return (await all()).some((r) => r.projectionHash === projectionHash);
    },
    async readByHash(projectionHash) {
      return (await all()).find((r) => r.projectionHash === projectionHash);
    },
  };
}
```

Add `export * from "./experiment-store.js";` to `claim-verification/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm build && node --test dist/tests/decision/claim-verification.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decision/decisions/claim-verification/experiment-store.ts src/decision/decisions/claim-verification/index.ts tests/decision/claim-verification.test.ts
git commit -m "feat(decision): protected experiment projection store"
```

---

### Task 4: `verify.claim` tool handler

**Files:**
- Create: `src/decision/paths.ts` (+ `export * from "./paths.js"` in `src/decision/index.ts`)
- Modify: `src/decision/engines/jev.ts` (host `JEV_KEY_PROVIDER_ID`), `src/cli/commands/jev/ops.ts` (import + re-export it; delegate `resolveJevPaths`)
- Modify: `src/decision/decisions/claim-verification/shadow.ts` (expose `projection`)
- Create: `src/tools/claim-verification-tool.ts`
- Test: `tests/tools/claim-verification-tool.test.ts` (new file)

**Interfaces:**
- Consumes: `selectClaimVerification` (Task 2), `createExperimentProjectionStore` (Task 3), `DECISION_MODE_VALUES`, `projectClaimVerification`, `createClaimVerificationProjector`, `classifyClaimLocally`, `createDefaultRegistry`, `registerJevEngine`, `createDecisionJournalStore`, `loadConfig`, `getSavedApiKey` (import from `../cli/helpers/api-keys.js` — existing precedent: `src/tools/web-search.ts:1` does exactly this), `JournalWriteError`, `ProjectionRejectedError`, `EngineNotRegisteredError`, `MAX_*` bounds, `ToolResult`.
- Produces: `handleClaimVerify(args, deps?): Promise<ToolResult>` with payload `{verdict, engine, decisionId?, authority:"none", warning?}`. `ClaimVerificationShadowResult.projection` (added here) is what Task 3's store persists. Task 5 wires the name `verify.claim` to this handler.

Why the three small moves in this task: the handler must locate the journal and resolve the TypeSafe key **without importing `src/cli/commands/*`** (only `cli/helpers/api-keys` has tools-side precedent in `web-search.ts`). Paths and the key id belong to the decision subsystem; `cli/commands/jev/ops.ts` keeps its existing exports by re-exporting, so `tests/cli/jev-ops.test.ts` keeps compiling.

- [ ] **Step 1: Write the failing test file**

Create `tests/tools/claim-verification-tool.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleClaimVerify,
  CLAIM_VERIFY_TOOL,
} from "../../src/tools/claim-verification-tool.js";
import {
  DEFAULT_DECISION_CONFIG,
  ProjectionRejectedError,
  JournalWriteError,
  JEV_CLAIM_QUESTION_ID,
  createDecisionJournalStore,
  createDefaultRegistry,
  registerJevEngine,
  createExperimentProjectionStore,
  MAX_CLAIM_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  type DecisionConfig,
  type DecisionJournalRecord,
  type JevTransport,
} from "../../src/decision/index.js";

const SUPPORTED = "Water boils at 100 degrees Celsius at sea level.";
const EVIDENCE = [{ excerpt: "At sea level, water boils at 100 degrees Celsius." }];

function configWith(mode: "baseline" | "shadow" | "active"): DecisionConfig {
  return {
    ...DEFAULT_DECISION_CONFIG,
    remote: { jev: { enabled: mode !== "baseline" } },
    claimVerification: {
      engine: mode === "baseline" ? "local" : "jev",
      fallback: "local",
      thresholdProfile: mode === "baseline" ? "claim-verification/local/v1" : "claim-verification/jev/v1",
      mode,
    },
  };
}

function okTransport(choice: string): JevTransport {
  return async () => ({
    model: "jev-1.13.0",
    answers: { [JEV_CLAIM_QUESTION_ID]: { type: "choice", choice } },
  });
}

function parseOutput(result: { kind: string; output?: string }): Record<string, unknown> {
  assert.equal(result.kind, "success");
  return JSON.parse(result.output ?? "{}") as Record<string, unknown>;
}

describe("verify.claim tool", () => {
  let cwd: string;
  let storeDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cv-tool-"));
    storeDir = join(cwd, "home-alix");
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("exposes the documented tool name", () => {
    assert.equal(CLAIM_VERIFY_TOOL, "verify.claim");
  });

  it("rejects a missing claim naming the requirement", async () => {
    const result = await handleClaimVerify(
      { evidence: EVIDENCE },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /non-empty string claim/);
  });

  it("rejects an over-long claim naming the limit, writing nothing", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: "x".repeat(MAX_CLAIM_CHARS + 1), evidence: [] },
      { cwd, config: configWith("baseline"), journal, experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_CLAIM_CHARS)));
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("rejects more than MAX_EVIDENCE_ITEMS items", async () => {
    const evidence = Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, () => ({ excerpt: "e" }));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_EVIDENCE_ITEMS)));
  });

  it("rejects an over-long excerpt naming the limit", async () => {
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: [{ excerpt: "x".repeat(MAX_EXCERPT_CHARS + 1) }] },
      { cwd, config: configWith("baseline"), experimentStoreDir: storeDir },
    );
    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, new RegExp(String(MAX_EXCERPT_CHARS)));
  });

  it("baseline mode: local verdict, no decisionId, no journal, no experiment record", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("baseline"), registry: createDefaultRegistry(), journal, experimentStoreDir: storeDir },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.equal(payload.authority, "none");
    assert.equal(payload.decisionId, undefined);
    assert.equal(payload.warning, undefined);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("shadow mode: payload carries only {verdict, engine, decisionId, authority}", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("shadow"), registry, journal, experimentStoreDir: storeDir, apiKey: "k" },
    );
    const payload = parseOutput(result);
    assert.deepEqual(
      Object.keys(payload).sort(),
      ["authority", "decisionId", "engine", "verdict"],
    );
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.equal(payload.authority, "none");
    assert.ok(typeof payload.decisionId === "string");
    assert.equal(JSON.stringify(payload).includes("agree"), false);
    assert.equal(journal.readAll().length, 2);
    const experiments = createExperimentProjectionStore(storeDir);
    const stored = await experiments.readByHash(
      journal.readAll()[0].projectionHash,
    );
    assert.equal(stored?.claim, SUPPORTED);
  });

  it("boundary rejection: local verdict + warning, no journal, no experiment record", async () => {
    const journal = createDecisionJournalStore(join(cwd, ".alix", "decisions"));
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: configWith("shadow"),
        registry: createDefaultRegistry(),
        journal,
        experimentStoreDir: storeDir,
        project: () => {
          throw new ProjectionRejectedError("secret-bearing evidence");
        },
      },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.equal(payload.engine, "local");
    assert.match(String(payload.warning), /remote verification skipped: secret-bearing evidence/);
    assert.equal(payload.decisionId, undefined);
    assert.equal(journal.readAll().length, 0);
    assert.equal(await createExperimentProjectionStore(storeDir).has("anything"), false);
  });

  it("journal write failure: verdict still returned with a warning", async () => {
    const journal = {
      append() {
        throw new JournalWriteError("disk full");
      },
      readAll: () => [] as DecisionJournalRecord[],
      findByDecision: () => [] as DecisionJournalRecord[],
      findByExecution: () => [] as DecisionJournalRecord[],
      findByProjectionHash: () => [] as DecisionJournalRecord[],
    };
    const registry = createDefaultRegistry();
    registerJevEngine(registry, { enabled: true, apiKey: "k", transport: okTransport("contradicted") });
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      { cwd, config: configWith("shadow"), registry, journal, experimentStoreDir: storeDir, apiKey: "k" },
    );
    const payload = parseOutput(result);
    assert.equal(payload.verdict, "supported");
    assert.match(String(payload.warning), /journal write failed/);
  });

  it("remote outage: tool stays available with the local verdict", async () => {
    const registry = createDefaultRegistry();
    registerJevEngine(registry, {
      enabled: true,
      apiKey: "k",
      transport: async () => {
        throw new Error("network down");
      },
    });
    const result = await handleClaimVerify(
      { claim: SUPPORTED, evidence: EVIDENCE },
      {
        cwd,
        config: configWith("shadow"),
        registry,
        journal: createDecisionJournalStore(join(cwd, ".alix", "decisions")),
        experimentStoreDir: storeDir,
        apiKey: "k",
      },
    );
    assert.equal(parseOutput(result).verdict, "supported");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build`
Expected: FAIL — module `src/tools/claim-verification-tool.js` does not exist; `JournalWriteError` may not yet be importable from the decision barrel (it is exported by `src/decision/journal.ts`, which the barrel re-exports — if the build complains, confirm the import resolves from `src/decision/index.js`).

- [ ] **Step 3: Implement the three supporting moves**

(a) Create `src/decision/paths.ts` and export it from `src/decision/index.ts`:

```ts
/** paths.ts — decision-state paths, owned by the decision subsystem so tools
 *  never import src/cli/commands/*. Mirrors what cli/commands/jev/ops.ts
 *  called resolveJevPaths (which now delegates here). */
import { join } from "node:path";

export type DecisionPaths = {
  dir: string;
  fixtures: string;
  profiles: string;
};

export function resolveDecisionPaths(cwd: string): DecisionPaths {
  const dir = join(cwd, ".alix", "decisions");
  return { dir, fixtures: join(dir, "fixtures"), profiles: join(dir, "profiles.json") };
}
```

In `src/decision/index.ts`, add `export * from "./paths.js";`.

(b) In `src/decision/engines/jev.ts`, add:

```ts
/** Provider id under which the TypeSafe/Jev key is stored (store-only). */
export const JEV_KEY_PROVIDER_ID = "typesafe";
```

In `src/cli/commands/jev/ops.ts`: replace `export const JEV_KEY_PROVIDER_ID = "typesafe";` with `import { JEV_KEY_PROVIDER_ID } from "../../decision/index.js";` plus `export { JEV_KEY_PROVIDER_ID };`, and change `resolveJevPaths` to delegate: `export function resolveJevPaths(cwd: string): JevPaths { return resolveDecisionPaths(cwd); }` (keep the `JevPaths` type alias = `DecisionPaths`). Existing imports from `ops.js` keep working.

(c) In `src/decision/decisions/claim-verification/shadow.ts`, two additive changes:
  - add `projection: ClaimVerificationProjection;` to `ClaimVerificationShadowResult` (import the type from `./projection.js`) and `projection: sealed.payload,` to the return. This is what the store persists — the *sealed* projection actually evaluated; re-sealing later could produce a different hash (`sealedAt`), so never re-project to reconstruct it.
  - add an optional boundary seam to `ClaimVerificationShadowDeps`: `project?: (input: ClaimVerificationInput) => RemoteSealedProjection<ClaimVerificationProjection>;`, then change `const sealed = projectClaimVerification(input);` to `const sealed = (deps.project ?? projectClaimVerification)(input);`. Tests inject a throwing `project` to exercise §12 without hardcoding a secret pattern (real secret rejection is already covered by `decision-boundary.test.ts`).

- [ ] **Step 4: Implement the handler**

Create `src/tools/claim-verification-tool.ts`:

```ts
/**
 * claim-verification-tool.ts — `verify.claim`: bounded claim verification over
 * inline evidence excerpts (spec 2026-09-22-claim-verification-shadow-tool-design.md).
 *
 * Grants no execution authority: `authority` is always "none" (JEV-8, J1).
 * Evidence is data, never instructions. The model sees only
 * { verdict, engine, decisionId?, authority, warning? } — never `agree`, the
 * baseline's competing verdict, latency, or the experiment tally (§8.3).
 *
 * No I/O of its own: callers pass excerpts already in context (JEV-2).
 */
import type { ToolResult } from "./types.js";
import { loadConfig } from "../config/loader.js";
import { getSavedApiKey } from "../cli/helpers/api-keys.js";
import {
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  JournalWriteError,
  JEV_KEY_PROVIDER_ID,
  MAX_CLAIM_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  ProjectionRejectedError,
  classifyClaimLocally,
  createClaimVerificationProjector,
  createDecisionJournalStore,
  createDefaultRegistry,
  createExperimentProjectionStore,
  projectClaimVerification,
  registerJevEngine,
  resolveDecisionPaths,
  selectClaimVerification,
  type ClaimVerificationExperimentProjection,
  type ClaimVerificationInput,
  type ClaimVerificationProjection,
  type DecisionConfig,
  type DecisionJournalStore,
  type EngineRegistry,
  type RemoteSealedProjection,
} from "../decision/index.js";

export const CLAIM_VERIFY_TOOL = "verify.claim";

export type ClaimVerifyToolDeps = {
  cwd?: string;
  config?: DecisionConfig;
  registry?: EngineRegistry;
  journal?: DecisionJournalStore;
  experimentStoreDir?: string;
  /** Overrides credential-store lookup (tests). */
  apiKey?: string | null;
  /** Boundary seam for tests; default seals via projectClaimVerification. */
  project?: (input: ClaimVerificationInput) => RemoteSealedProjection<ClaimVerificationProjection>;
  /** Store seam for tests; default appends to the protected store. */
  saveExperiment?: (record: ClaimVerificationExperimentProjection) => Promise<void>;
};

function error(message: string): ToolResult {
  return { kind: "error", message, retryable: false };
}

/** Explicit bounds (§8.2): reject naming the limit, never silently clip. */
type ValidateResult =
  | { ok: true; input: ClaimVerificationInput }
  | { ok: false; result: ToolResult };

function validate(args: Record<string, unknown>): ValidateResult {
  const claim = args.claim;
  if (typeof claim !== "string" || claim.trim().length === 0) {
    return { ok: false, result: error("verify.claim requires a non-empty string claim") };
  }
  if (claim.length > MAX_CLAIM_CHARS) {
    return { ok: false, result: error(`claim exceeds ${MAX_CLAIM_CHARS} characters — shorten it`) };
  }
  const evidence = args.evidence;
  if (evidence === undefined) return { ok: true, input: { claim, evidence: [] } };
  if (!Array.isArray(evidence)) {
    return { ok: false, result: error("evidence must be an array of { source?, excerpt }") };
  }
  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    return {
      ok: false,
      result: error(`evidence exceeds ${MAX_EVIDENCE_ITEMS} items — send the ${MAX_EVIDENCE_ITEMS} most relevant`),
    };
  }
  const excerpted: ClaimVerificationInput["evidence"] = [];
  for (const item of evidence) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, result: error("each evidence item must be { source?, excerpt }") };
    }
    const record = item as Record<string, unknown>;
    const excerpt = record.excerpt;
    if (typeof excerpt !== "string" || excerpt.length === 0) {
      return { ok: false, result: error("each evidence item requires a non-empty excerpt string") };
    }
    if (excerpt.length > MAX_EXCERPT_CHARS) {
      return { ok: false, result: error(`evidence excerpt exceeds ${MAX_EXCERPT_CHARS} characters`) };
    }
    excerpted.push({
      ...(typeof record.source === "string" ? { source: record.source } : {}),
      excerpt,
    });
  }
  return { ok: true, input: { claim, evidence: excerpted } };
}

async function loadDecisionConfig(cwd: string): Promise<DecisionConfig> {
  const config = await loadConfig(cwd, { requireModel: false, suppressWarnings: true });
  return config.decision ?? DEFAULT_DECISION_CONFIG;
}

/** Wrap the journal so a failed append degrades into a warning (§14: never
 *  crash, never silent) WITHOUT losing the verdict: runClaimVerificationShadow
 *  appends before it returns, so catching afterwards would discard the result.
 *  `warnings` is the handler's live array — read it after the call. */
function withCapturedJournal(
  journal: DecisionJournalStore,
  warnings: string[],
): DecisionJournalStore {
  return {
    ...journal,
    append(record: Parameters<DecisionJournalStore["append"]>[0]) {
      try {
        journal.append(record);
      } catch (cause) {
        warnings.push(`decision journal write failed: ${(cause as Error).message}`);
      }
    },
  };
}

export async function handleClaimVerify(
  args: Record<string, unknown>,
  deps: ClaimVerifyToolDeps = {},
): Promise<ToolResult> {
  const validated = validate(args);
  if (!validated.ok) return validated.result;
  const input = validated.input;

  const cwd = deps.cwd ?? process.cwd();
  const config = deps.config ?? (await loadDecisionConfig(cwd));
  const mode = config.claimVerification?.mode ?? "baseline";
  const paths = resolveDecisionPaths(cwd);
  const journal = deps.journal ?? createDecisionJournalStore(paths.dir);
  const warnings: string[] = [];

  let registry = deps.registry;
  if (registry === undefined) {
    registry = createDefaultRegistry();
    if (config.remote?.jev?.enabled === true && config.claimVerification?.engine === "jev") {
      const key = deps.apiKey === undefined ? await getSavedApiKey(JEV_KEY_PROVIDER_ID) : deps.apiKey;
      // Register even without a key: the executor then fails "api key missing"
      // inside executeWithFallback, which degrades to local (§13).
      registerJevEngine(registry, { enabled: true, ...(key ? { apiKey: key } : {}) });
    }
  }

  const journalStore = withCapturedJournal(journal, warnings);

  if (mode === "baseline") {
    const selection = await selectClaimVerification(input, {
      config,
      registry,
      journal,
      mode,
    });
    return {
      kind: "success",
      output: JSON.stringify({
        verdict: selection.verdict,
        engine: selection.engineId ?? "local",
        authority: "none",
      }),
    };
  }

  let selection: Awaited<ReturnType<typeof selectClaimVerification>>;
  try {
    selection = await selectClaimVerification(input, {
      config,
      registry,
      journal: journalStore,
      mode,
      ...(deps.project !== undefined ? { project: deps.project } : {}),
    });
  } catch (cause) {
    if (cause instanceof ProjectionRejectedError || cause instanceof EngineNotRegisteredError) {
      // §12 / §13: fail closed for egress, remain useful locally. No seal ⇒
      // no projectionHash ⇒ no journal record and no experiment record.
      const plain = createClaimVerificationProjector().project(input);
      const { verdict } = classifyClaimLocally(plain);
      warnings.push(
        cause instanceof ProjectionRejectedError
          ? `remote verification skipped: ${cause.message}`
          : `remote engine unavailable: ${cause.message}`,
      );
      return {
        kind: "success",
        output: JSON.stringify({ verdict, engine: "local", authority: "none", warning: warnings.join("; ") }),
      };
    }
    throw cause;
  }

  // Journal-write failures already landed in `warnings` via withCapturedJournal.

  const decisionId = selection.shadow?.records.find(
    (record) => record.engineId === selection.engineId && record.outcome.kind === "choice",
  )?.decisionId;

  const projection = selection.shadow?.projection;
  if (projection !== undefined) {
    const save =
      deps.saveExperiment ??
      (async (record: ClaimVerificationExperimentProjection) => {
        const store = createExperimentProjectionStore(deps.experimentStoreDir);
        if (!(await store.has(record.projectionHash))) await store.append(record);
      });
    try {
      await save({
        projectionHash: selection.shadow!.projectionHash,
        decision: "claim-verification",
        claim: projection.claim,
        evidence: projection.evidence.map((excerpt) => ({ excerpt })),
        createdAt: new Date().toISOString(),
      });
    } catch (cause) {
      warnings.push(`experiment projection write failed: ${(cause as Error).message}`);
    }
  }

  const payload: Record<string, unknown> = {
    verdict: selection.verdict,
    engine: selection.engineId ?? "local",
    ...(decisionId !== undefined ? { decisionId } : {}),
    authority: "none",
    ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
  };
  return { kind: "success", output: JSON.stringify(payload) };
}
```

Three details the tests depend on:
- `validate` returns a discriminated union, so validation errors return immediately with nothing written — no shape sniffing.
- `withCapturedJournal(journal, warnings)` pushes into the handler's **live** `warnings` array, because the append happens *inside* `runClaimVerificationShadow` — catching after that call would discard the verdict entirely.
- `deps.project` is the boundary seam the §12 test injects; `shadow.ts` accepts it (Step 3c). The default stays `projectClaimVerification`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm build && node --test dist/tests/tools/claim-verification-tool.test.js dist/tests/cli/jev-ops.test.js`
Expected: PASS — new tool tests pass and the existing CLI tests still pass (they exercise `resolveJevPaths`/`JEV_KEY_PROVIDER_ID` through their re-exports).

- [ ] **Step 6: Commit**

```bash
git add src/decision/paths.ts src/decision/index.ts src/decision/engines/jev.ts src/decision/decisions/claim-verification/shadow.ts src/tools/claim-verification-tool.ts src/cli/commands/jev/ops.ts tests/tools/claim-verification-tool.test.ts
git commit -m "feat(tools): verify.claim handler with baseline/shadow degradation"
```

---

### Task 5: Tool surface wiring (the seven edits that must land together)

**Files:**
- Modify: `src/tools/tool-registry.ts`, `src/config/defaults.ts`, `src/run/helpers.ts`, `src/agents/tool-name-map.ts`, `src/tools/tool-router.ts`, `src/tools/executor.ts`, `src/agent/agent-loop.ts`
- Test: `tests/tools/capability-map.test.ts`

**Interfaces:**
- Consumes: `handleClaimVerify` + `CLAIM_VERIFY_TOOL` (Task 4).
- Produces: model-facing tool `alix_verify_claim` → executor name `verify.claim` → policy key `verify.claim` (`allow`), read-only in `--read-only` runs. Until all seven land, the tool either does not reach the model or prompts for approval per call (spec §7.1).

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/capability-map.test.ts` (add imports: `BASE_TOOLS`, `READ_ONLY_TOOL_NAMES` not needed; add `import { BASE_TOOLS } from "../../src/run/helpers.js";`, `import { TOOL_NAME_MAP } from "../../src/agents/tool-name-map.js";`, `import { DEFAULT_CONFIG } from "../../src/config/defaults.js";`):

```ts
describe("verify.claim wiring (spec §7.1 approval trap)", () => {
  it("resolves its own policy key — never tool.invoke", () => {
    assert.equal(inferCapability("verify.claim"), "verify.claim");
    assert.notEqual(inferCapability("verify.claim"), "tool.invoke");
    assert.equal(canonicalCapabilityOf("verify.claim"), "decision.claim-verification");
  });

  it("is allowed without an approval prompt", () => {
    assert.equal(DEFAULT_CONFIG.permissions.tools["verify.claim"], "allow");
  });

  it("is read-only and non-mutating in the registry", () => {
    const entry = buildDefaultToolIndex().registry.lookup("verify.claim");
    assert.ok(entry, "registry entry missing — inferCapability would fall back to tool.invoke");
    assert.equal(entry.risk, "low");
    assert.equal(entry.mutates, false);
    assert.equal(entry.policyKey, "verify.claim");
    assert.equal(entry.domain, "decision");
  });

  it("reaches the model: manifest entry + alias", () => {
    const manifest = BASE_TOOLS.find((tool) => tool.name === "alix_verify_claim");
    assert.ok(manifest, "alix_verify_claim missing from BASE_TOOLS");
    assert.deepEqual(manifest.input_schema.required, ["claim"]);
    assert.equal(TOOL_NAME_MAP.alix_verify_claim, "verify.claim");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/tools/capability-map.test.js`
Expected: FAIL — `inferCapability("verify.claim")` returns `tool.invoke`.

- [ ] **Step 3: Implement all seven edits**

(a) `src/tools/tool-registry.ts` — extend `ToolDomain` with `"decision"` (the union has no exhaustive consumer outside this file) and add to the `defaults` array:

```ts
    {
      name: "verify.claim",
      capabilityId: "decision.claim-verification",
      policyKey: "verify.claim",
      description: "Verify whether evidence supports a claim (supported/contradicted/insufficient)",
      risk: "low",
      domain: "decision",
      mutates: false,
      alwaysInclude: true,
      tags: ["claim", "verify", "evidence", "decision", "read"],
    },
```

(b) `src/config/defaults.ts` — in `permissions.tools`: `"verify.claim": "allow",`.

(c) `src/run/helpers.ts` — in `BASE_TOOLS`, immediately after the `alix_state_query` entry:

```ts
  {
    name: "alix_verify_claim",
    description: "Verify whether supplied evidence supports a claim: returns supported, contradicted, or insufficient. Pass the claim and short excerpts you already have in context (max 8 excerpts, 1200 chars each) — it fetches nothing, needs no approval, and grants no authority: it is an observation for you to weigh, not a directive.",
    input_schema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "The claim to check (max 2000 characters)" },
        evidence: {
          type: "array",
          maxItems: 8,
          description: "Evidence excerpts already in your context (max 8)",
          items: {
            type: "object",
            properties: {
              source: { type: "string", description: "Optional provenance label (never a filesystem path)" },
              excerpt: { type: "string", description: "Quoted supporting or contradicting text (max 1200 characters)" },
            },
            required: ["excerpt"],
          },
        },
      },
      required: ["claim"],
    },
  },
```

(d) `src/agents/tool-name-map.ts` — after `alix_state_query: "state.query",`:

```ts
  alix_verify_claim:    "verify.claim",
```

(e) `src/tools/tool-router.ts` — next to `StateToolRouter`:

```ts
/**
 * verify.claim — bounded claim verification over inline evidence (spec
 * 2026-09-22-claim-verification-shadow-tool-design.md). Pure judgement: no I/O,
 * no execution authority.
 */
export class ClaimVerificationToolRouter implements ToolRouter {
  constructor(private readonly cwd: string) {}

  canHandle(name: string): boolean {
    return name === "verify.claim";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { handleClaimVerify } = await import("./claim-verification-tool.js");
    return handleClaimVerify(request.args as Record<string, unknown>, { cwd: this.cwd });
  }
}
```

(f) `src/tools/executor.ts` — import `ClaimVerificationToolRouter` alongside `StateToolRouter` (line ~29) and insert after `new StateToolRouter(this.root),`:

```ts
      new ClaimVerificationToolRouter(this.root),
```

(g) `src/agent/agent-loop.ts` — after `readOnlyToolFilter.add("alix_state_query");`:

```ts
  readOnlyToolFilter.add("alix_verify_claim");
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm build && node --test dist/tests/tools/capability-map.test.js dist/tests/tools/tool-registry.test.js dist/tests/tools/claim-verification-tool.test.js`
Expected: PASS — including the existing `registry-derived views agree with buildDefaultToolIndex` loop, which now covers `verify.claim` automatically.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-registry.ts src/config/defaults.ts src/run/helpers.ts src/agents/tool-name-map.ts src/tools/tool-router.ts src/tools/executor.ts src/agent/agent-loop.ts tests/tools/capability-map.test.ts
git commit -m "feat(tools): wire alix_verify_claim (manifest, alias, allow, router)"
```

---

### Task 6: `alix jev disagreements`

**Files:**
- Modify: `src/cli/commands/jev/ops.ts`, `src/cli/commands/jev/render.ts`, `src/cli/commands/jev/main.ts`
- Test: `tests/cli/jev-ops.test.ts`

**Interfaces:**
- Consumes: `createDecisionJournalStore`, `createOutcomeLabelStore`, `indexLabelsByDecisionId`, `JEV_ENGINE_ID`, `LOCAL_ENGINE_ID`, `recordDecision`, `resolveJevPaths`, `parseKeyValueArgs`/`optionalDecision` (main.ts), `JevOperatorError`.
- Produces: `groupChoiceByEngine(records, decision)`, `buildDisagreements(paths, opts): Promise<DisagreementsReport>`, `renderDisagreements(report): string`. Task 7 reuses `groupChoiceByEngine`.

Grouping rules (spec §15, §17, plan amendment 2): group all records of a decision by `projectionHash` (`invocations` = every group, including failure-only ones); within a group keep the **most recent** `outcome.kind === "choice"` record per `engineId`; `paired` = groups containing **both** `JEV_ENGINE_ID` and `LOCAL_ENGINE_ID` choice records — a third engine may be journalled but never joins the comparison; `disagreements` = paired groups whose two verdicts differ; `disagreement_rate = disagreements / paired` with `paired` as the explicit denominator (never all tool calls).

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/jev-ops.test.ts`:

```ts
/** Per-test journal so assertions stay absolute, never cumulative. */
const tempDirs: string[] = [];
function freshPaths(): ReturnType<typeof resolveJevPaths> {
  const dir = mkdtempSync(join(tmpdir(), "jev-dis-"));
  tempDirs.push(dir);
  return resolveJevPaths(dir);
}

/** Seed one claim-verification group into `target`: local + jev choice records (+ optional truth labels). */
async function seedClaimPair(
  target: ReturnType<typeof resolveJevPaths>,
  hash: string,
  localVerdict: "supported" | "contradicted" | "insufficient",
  jevVerdict: "supported" | "contradicted" | "insufficient",
  truth?: "supported" | "contradicted" | "insufficient",
): Promise<void> {
  const journal = createDecisionJournalStore(target.dir);
  const candidates = ["supported", "contradicted", "insufficient"];
  const local = recordDecision({
    decision: "claim-verification",
    engineId: "local",
    projectionHash: hash,
    outcome: { kind: "choice", choice: localVerdict, candidates },
    latencyMs: 1,
    remote: false,
    redactionApplied: false,
    now: 1_700_000_000_000,
  });
  const jev = recordDecision({
    decision: "claim-verification",
    engineId: "jev",
    projectionHash: hash,
    outcome: { kind: "choice", choice: jevVerdict, candidates, confidence: 0.8 },
    latencyMs: 12,
    remote: true,
    redactionApplied: true,
    now: 1_700_000_000_500,
  });
  journal.append(local);
  journal.append(jev);
  if (truth !== undefined) {
    const labelStore = createOutcomeLabelStore(target.dir);
    await labelStore.append(
      createOutcomeLabel({
        decisionId: local.decisionId,
        decision: "claim-verification",
        label: localVerdict === truth ? "correct" : "incorrect",
        note: `truth=${truth}`,
        observedAt: 1_700_000_001_000,
      }),
    );
    await labelStore.append(
      createOutcomeLabel({
        decisionId: jev.decisionId,
        decision: "claim-verification",
        label: jevVerdict === truth ? "correct" : "incorrect",
        note: `truth=${truth}`,
        observedAt: 1_700_000_001_500,
      }),
    );
  }
}

describe("jev ops — disagreements", () => {
  it("reports no disagreement data available when the journal is empty", async () => {
    const target = freshPaths();
    const report = await buildDisagreements(target, {});
    assert.equal(report.invocations, 0);
    assert.equal(report.paired, 0);
    assert.equal(report.disagreementRate, "n/a");
    const text = renderDisagreements(report);
    assert.match(text, /no disagreement data available/);
    assert.doesNotMatch(text, /the engines always agree/);
  });

  it("tallies a labelled disagreement pair", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:dis-1", "supported", "insufficient", "supported");
    const report = await buildDisagreements(target, {});
    assert.equal(report.invocations, 1);
    assert.equal(report.paired, 1);
    assert.equal(report.disagreements, 1);
    assert.equal(report.agreements, 0);
    assert.equal(report.disagreementRate, "100.0%");
    assert.equal(report.labelled, 1);
    assert.equal(report.unlabelled, 0);
    assert.equal(report.baselineCorrect, 1);
    assert.equal(report.jevCorrect, 0);
    assert.equal(report.bothWrong, 0);
    assert.match(renderDisagreements(report), /PAIR sha256:dis-1/);
  });

  it("counts agreement separately and reports the denominator", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:agree-1", "supported", "supported");
    await seedClaimPair(target, "sha256:dis-2", "contradicted", "supported");
    const report = await buildDisagreements(target, {});
    assert.equal(report.paired, 2);
    assert.equal(report.agreements, 1);
    assert.equal(report.disagreements, 1);
    assert.equal(report.disagreementRate, "50.0%");
    const text = renderDisagreements(report);
    assert.match(text, /paired=2/);
    assert.match(text, /comparable_pairs=2/);
    assert.match(text, /the engines agree on 1/);
  });

  it("marks both-wrong when neither recorded verdict matches truth", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:both-wrong", "supported", "contradicted", "insufficient");
    const report = await buildDisagreements(target, {});
    assert.equal(report.bothWrong, 1);
    assert.equal(report.labelled, 1);
  });

  it("ignores failure outcomes when pairing but still counts the invocation", async () => {
    const target = freshPaths();
    const journal = createDecisionJournalStore(target.dir);
    journal.append(
      recordDecision({
        decision: "claim-verification",
        engineId: "jev",
        projectionHash: "sha256:only-failure",
        outcome: { kind: "failure", error: "timeout" },
        latencyMs: 30_000,
        remote: true,
        redactionApplied: false,
        now: 1_700_000_002_000,
      }),
    );
    const report = await buildDisagreements(target, {});
    assert.equal(report.invocations, 1); // spec §17: invocations counts every group
    assert.equal(report.paired, 0);
    assert.equal(report.disagreements, 0);
    assert.match(renderDisagreements(report), /no disagreement data available/);
    assert.match(renderDisagreements(report), /1 invocation\(s\)/);
  });

  it("keeps the most recent choice record per engine", async () => {
    const target = freshPaths();
    const journal = createDecisionJournalStore(target.dir);
    const candidates = ["supported", "contradicted", "insufficient"];
    const stale = recordDecision({
      decision: "claim-verification",
      engineId: "local",
      projectionHash: "sha256:latest",
      outcome: { kind: "choice", choice: "contradicted", candidates },
      latencyMs: 1,
      remote: false,
      redactionApplied: false,
      now: 1_600_000_000_000,
    });
    journal.append(stale);
    await seedClaimPair(target, "sha256:latest", "supported", "insufficient");
    const report = await buildDisagreements(target, {});
    // The newer "supported" record won, so verdicts still differ (supported vs insufficient)
    // and the stale "contradicted" never produced a third engine.
    assert.equal(report.paired, 1);
    assert.equal(report.disagreements, 1);
  });

  it("pairs only Jev + local — a third engine never changes the denominator", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:third", "supported", "insufficient");
    const journal = createDecisionJournalStore(target.dir);
    journal.append(
      recordDecision({
        decision: "claim-verification",
        engineId: "other-engine",
        projectionHash: "sha256:third",
        outcome: { kind: "choice", choice: "contradicted", candidates: ["supported", "contradicted", "insufficient"] },
        latencyMs: 3,
        remote: false,
        redactionApplied: false,
        now: 1_700_000_004_000,
      }),
    );
    const report = await buildDisagreements(target, {});
    const pair = report.pairs.find((p) => p.projectionHash === "sha256:third");
    assert.equal(report.paired, 1); // still exactly one experiment pair
    assert.equal(report.disagreements, 1);
    assert.deepEqual(pair?.sides.map((side) => side.engineId), ["jev", "local"]);
  });

  it("does not pair a group that lacks Jev or the local baseline", async () => {
    const target = freshPaths();
    const journal = createDecisionJournalStore(target.dir);
    const candidates = ["supported", "contradicted", "insufficient"];
    journal.append(
      recordDecision({
        decision: "claim-verification",
        engineId: "other-a",
        projectionHash: "sha256:no-experiment-pair",
        outcome: { kind: "choice", choice: "supported", candidates },
        latencyMs: 1,
        remote: false,
        redactionApplied: false,
        now: 1_700_000_005_000,
      }),
    );
    journal.append(
      recordDecision({
        decision: "claim-verification",
        engineId: "other-b",
        projectionHash: "sha256:no-experiment-pair",
        outcome: { kind: "choice", choice: "contradicted", candidates },
        latencyMs: 1,
        remote: false,
        redactionApplied: false,
        now: 1_700_000_005_500,
      }),
    );
    const report = await buildDisagreements(target, {});
    assert.equal(report.invocations, 1);
    assert.equal(report.paired, 0); // neither engine is Jev or the baseline
    assert.equal(report.disagreements, 0);
  });

  it("dispatches through the CLI (hermetic cwd, captured stdout)", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      await dispatchJevCommand(["disagreements", "--json"], { cwd });
    } finally {
      (process.stdout as unknown as { write: typeof original }).write = original;
    }
    const report = JSON.parse(chunks.join("")) as { decision: string };
    assert.equal(report.decision, "claim-verification");
  });
});
```

Add to that file's `src/cli/commands/jev/ops.js` import list: `buildDisagreements`; from `render.js`: `renderDisagreements`. (Existing imports already include `createOutcomeLabelStore`, `recordDecision`, `createOutcomeLabel`, `dispatchJevCommand`.) Also extend the file's existing `after()` hook to clean the fresh journals: `for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });`

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/cli/jev-ops.test.js`
Expected: FAIL — `buildDisagreements is not a function` / unknown subcommand `disagreements`.

- [ ] **Step 3: Implement ops**

Append to `src/cli/commands/jev/ops.ts`:

```ts
// ─── Disagreements ────────────────────────────────────────────────────

export type DisagreementSide = {
  engineId: string;
  decisionId: string;
  verdict: string;
  label?: OutcomeLabel;
};

export type DisagreementPair = {
  projectionHash: string;
  /** Exactly two sides: Jev, then local baseline (plan amendment 2). */
  sides: DisagreementSide[];
};

export type DisagreementsReport = {
  decision: DecisionType;
  invocations: number;
  paired: number;
  agreements: number;
  disagreements: number;
  disagreementRate: string; // "27.5%" or "n/a"
  labelled: number;
  unlabelled: number;
  jevCorrect: number;
  baselineCorrect: number;
  bothWrong: number;
  pairs: DisagreementPair[];
};

/** projectionHash -> engineId -> most recent Choice record (spec §15). */
export function groupChoiceByEngine(
  records: readonly DecisionJournalRecord[],
  decision: DecisionType,
): Map<string, Map<string, DecisionJournalRecord>> {
  const groups = new Map<string, Map<string, DecisionJournalRecord>>();
  for (const record of records) {
    if (record.decision !== decision || record.outcome.kind !== "choice") continue;
    const byEngine = groups.get(record.projectionHash) ?? new Map<string, DecisionJournalRecord>();
    const previous = byEngine.get(record.engineId);
    if (previous === undefined || record.timestamp >= previous.timestamp) {
      byEngine.set(record.engineId, record);
    }
    groups.set(record.projectionHash, byEngine);
  }
  return groups;
}
```

`groupChoiceByEngine` groups **every** engine (it is a journal view). The
experiment comparison that consumes it must then pick exactly
`JEV_ENGINE_ID` + `LOCAL_ENGINE_ID` — see Step 3. Do not "generalise" the
consumer: a third engine would silently change the denominator and could
produce a three-label write in `label-pair` (plan amendment 2).

```ts
export async function buildDisagreements(
  paths: JevPaths,
  opts: { decision?: DecisionType },
): Promise<DisagreementsReport> {
  const decision = opts.decision ?? "claim-verification";
  const records = createDecisionJournalStore(paths.dir).readAll();
  // invocations = EVERY group of this decision (spec §17 shows invocations=42,
  // paired=40) — failure-only groups count as invocations but can never pair.
  const invocations = new Set(
    records.filter((record) => record.decision === decision).map((record) => record.projectionHash),
  ).size;
  const groups = groupChoiceByEngine(records, decision);
  const labels = indexLabelsByDecisionId(
    (await createOutcomeLabelStore(paths.dir).readAll()).labels,
  );

  let paired = 0;
  let disagreements = 0;
  const pairs: DisagreementPair[] = [];
  let labelled = 0;
  let jevCorrect = 0;
  let baselineCorrect = 0;
  let bothWrong = 0;

  for (const [projectionHash, byEngine] of groups) {
    // The experiment is Jev vs the local baseline ONLY (plan amendment 2).
    // A group that lacks either — or that has a third engine instead of one
    // of them — is not a comparable experiment pair. Third-engine records
    // stay journalled; they never enter the denominator or the tallies.
    const jevRecord = byEngine.get(JEV_ENGINE_ID);
    const baselineRecord = byEngine.get(LOCAL_ENGINE_ID);
    if (jevRecord === undefined || baselineRecord === undefined) continue;
    paired += 1;
    const sides: DisagreementSide[] = [jevRecord, baselineRecord].map((record) => ({
      engineId: record.engineId,
      decisionId: record.decisionId,
      verdict: String((record.outcome as { choice: unknown }).choice),
      label: labels.get(record.decisionId)?.label,
    }));

    if (sides[0].verdict === sides[1].verdict) continue; // agreement

    disagreements += 1;
    pairs.push({ projectionHash, sides });

    const allLabelled = sides.every((side) => side.label !== undefined);
    if (!allLabelled) continue;
    labelled += 1;
    if (sides[0].label === "correct") jevCorrect += 1;
    if (sides[1].label === "correct") baselineCorrect += 1;
    if (sides.every((side) => side.label === "incorrect")) bothWrong += 1;
  }

  return {
    decision,
    invocations,
    paired,
    agreements: paired - disagreements,
    disagreements,
    disagreementRate: paired > 0 ? `${((disagreements / paired) * 100).toFixed(1)}%` : "n/a",
    labelled,
    unlabelled: disagreements - labelled,
    jevCorrect,
    baselineCorrect,
    bothWrong,
    pairs,
  };
}
```

Imports to add at the top of `ops.ts` as needed: `DecisionJournalRecord`, `indexLabelsByDecisionId`, `JEV_ENGINE_ID`, `LOCAL_ENGINE_ID`, `OutcomeLabel`, `DecisionType` (several already come via the decision barrel import).

- [ ] **Step 4: Implement render**

Append to `src/cli/commands/jev/render.ts`:

```ts
export function renderDisagreements(report: DisagreementsReport): string {
  const lines: string[] = [`Disagreements — ${report.decision}`];
  if (report.paired === 0) {
    lines.push("  no disagreement data available");
    if (report.invocations > 0) {
      lines.push(`  (${report.invocations} invocation(s) produced no comparable pair — engine not remote, remote disabled, or attempts failed)`);
    }
    return lines.join("\n");
  }

  for (const pair of report.pairs) {
    lines.push("");
    lines.push(`PAIR ${pair.projectionHash}`);
    lines.push("");
    for (const side of pair.sides) {
      const label = side.engineId === "jev" ? "Jev" : side.engineId === "local" ? "Baseline" : side.engineId;
      lines.push(`${label}:`);
      lines.push(`  verdict: ${side.verdict}`);
      lines.push(`  decision: ${side.decisionId}`);
      lines.push("");
    }
    const allLabelled = pair.sides.every((side) => side.label !== undefined);
    if (allLabelled) {
      lines.push("labels:");
      for (const side of pair.sides) lines.push(`  ${side.engineId}: ${side.label}`);
    } else {
      lines.push("label: unlabelled");
    }
  }

  lines.push("");
  lines.push(`invocations=${report.invocations}`);
  lines.push(`paired=${report.paired}`);
  lines.push(`comparable_pairs=${report.paired}`);
  lines.push(`agreements=${report.agreements}`);
  lines.push(`disagreements=${report.disagreements}`);
  lines.push(`disagreement_rate=${report.disagreementRate}`);
  lines.push("");
  lines.push(`labelled=${report.labelled}`);
  lines.push(`unlabelled=${report.unlabelled}`);
  lines.push("");
  lines.push(`jev_correct=${report.jevCorrect}`);
  lines.push(`baseline_correct=${report.baselineCorrect}`);
  lines.push(`both_wrong=${report.bothWrong}`);
  if (report.disagreements > 0 && report.agreements > 0) {
    lines.push("");
    lines.push(`the engines agree on ${report.agreements} of ${report.paired} comparable pairs`);
  }
  return lines.join("\n");
}
```

Add `DisagreementsReport` to `render.ts`'s imports from `./ops.js`.

- [ ] **Step 5: Implement dispatch**

In `src/cli/commands/jev/main.ts`, first make dispatch hermetic (existing single-argument callers are unaffected):

```ts
export async function dispatchJevCommand(
  args: string[],
  opts?: { cwd?: string },
): Promise<void> {
  const paths = resolveJevPaths(opts?.cwd ?? process.cwd());
```

Then add before `default:`:

```ts
    case "disagreements": {
      const flags = parseKeyValueArgs(rest, ["decision"], ["json"]);
      const report = await buildDisagreements(
        paths,
        optionalDecision(flags.decision) !== undefined
          ? { decision: optionalDecision(flags.decision)! }
          : {},
      );
      out(json ? JSON.stringify(report, null, 2) : renderDisagreements(report));
      return;
    }
```

Add `buildDisagreements` to the `./ops.js` import and `renderDisagreements` to the `./render.js` import, and extend the unknown-subcommand message: `… expected status, label, dataset, reliability, profile, fixture, replay, disagreements`.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm build && node --test dist/tests/cli/jev-ops.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/jev/ops.ts src/cli/commands/jev/render.ts src/cli/commands/jev/main.ts tests/cli/jev-ops.test.ts
git commit -m "feat(jev-cli): disagreements view with pairing, rate and tallies"
```

---

### Task 7: `alix jev label-pair` (two-stage blind ground-truth labelling)

**Files:**
- Modify: `src/cli/commands/jev/ops.ts`, `src/cli/commands/jev/render.ts`, `src/cli/commands/jev/main.ts`
- Test: `tests/cli/jev-ops.test.ts`

**Interfaces:**
- Consumes: `groupChoiceByEngine` (Task 6), `createExperimentProjectionStore`/`ClaimVerificationExperimentProjection` (Task 3), `createOutcomeLabel`/`createOutcomeLabelStore`/`indexLabelsByDecisionId`, `CLAIM_VERDICT_CANDIDATES`, `JEV_ENGINE_ID`, `LOCAL_ENGINE_ID`, `JevOperatorError`, `promptUser` (from `../../../run/helpers.js`).
- Produces: `LabelPairStage`, `prepareLabelPair(paths, {projectionHash, storeDir?}): Promise<LabelPairStage>` (structural refusals only, **returns no verdicts**), `commitLabelPair(paths, {projectionHash, truth, storeDir?}): Promise<LabelPairResult>` (truth-legality + already-labelled refusals, derives and appends exactly two labels in fixed order Jev→baseline), `renderLabelPairEvidence(stage)`, `renderLabelPairReveal(result)`, CLI subcommand `label-pair`.

**Two-stage contract (plan amendment 1 — blindness must be structural, not cosmetic):**

```text
Stage 1  prepare  → structural refusals (no direction revealed)
         renderLabelPairEvidence → Claim + Evidence only
         prompt `Truth [supported|contradicted|insufficient]: `   (interactive)
Stage 2  commit   → truth legality + already-labelled refusals → derive → append 2 labels
         renderLabelPairReveal → Truth, then Jev/Baseline verdicts
```

- Interactive default: no `--truth` → stage 1 output, prompt, stage 2.
- Non-interactive: `--truth <v>` — documented as the path where the caller already
  established truth independently; stage 1 still runs (structural refusals fire
  first), then commit, then reveal.
- `--json` **without** `--truth` is a usage error (interactive prompting is TTY-only).
- Refusal ordering: every refusal fires before any label is appended — a
  judgement is never silently overwritten.

**Scope (plan amendment 4):** claim-verification **only** in this phase. Other
decisions have no protected projection store (§16 is `ClaimVerificationExperimentProjection`),
so §18.1's evidence view is impossible for them — they are refused with an
actionable message rather than admitted through a side door. Generalise when
those decisions gain equivalent evidence-review infrastructure.

**Pairing (plan amendment 2):** exactly `JEV_ENGINE_ID` + `LOCAL_ENGINE_ID`,
in that fixed order. A third engine is never labelled and never counted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/jev-ops.test.ts`:

```ts
describe("jev ops — label-pair (two-stage blind)", () => {
  /** Journal pair + matching protected projection, both on fresh dirs. */
  async function seededPair(
    hash: string,
    localVerdict: "supported" | "contradicted" | "insufficient",
    jevVerdict: "supported" | "contradicted" | "insufficient",
    truth?: "supported" | "contradicted" | "insufficient",
  ): Promise<{ target: ReturnType<typeof resolveJevPaths>; storeDir: string }> {
    const target = freshPaths();
    await seedClaimPair(target, hash, localVerdict, jevVerdict, truth);
    const storeDir = mkdtempSync(join(tmpdir(), "jev-lp-"));
    tempDirs.push(storeDir);
    await createExperimentProjectionStore(storeDir).append({
      projectionHash: hash,
      decision: "claim-verification",
      claim: SUPPORTED_CLAIM,
      evidence: [{ excerpt: SUPPORTED_EXCERPT }],
      createdAt: "2026-09-22T00:00:00.000Z",
    });
    return { target, storeDir };
  }

  it("prepare refuses an unknown projectionHash, writing nothing", async () => {
    const target = freshPaths();
    await assert.rejects(
      prepareLabelPair(target, { projectionHash: "sha256:nope", storeDir: target.dir }),
      /projectionHash unknown/,
    );
    assert.equal((await createOutcomeLabelStore(target.dir).readAll()).labels.length, 0);
  });

  it("prepare refuses non-claim-verification decisions (no protected projection store)", async () => {
    const target = freshPaths();
    const journal = createDecisionJournalStore(target.dir);
    journal.append(
      recordDecision({
        decision: "context-relevance",
        engineId: "local",
        projectionHash: "sha256:noul",
        outcome: { kind: "noul", probability: 0.9 },
        latencyMs: 1,
        remote: false,
        redactionApplied: false,
        now: 1_700_000_003_000,
      }),
    );
    journal.append(
      recordDecision({
        decision: "context-relevance",
        engineId: "jev",
        projectionHash: "sha256:noul",
        outcome: { kind: "noul", probability: 0.4 },
        latencyMs: 2,
        remote: true,
        redactionApplied: true,
        now: 1_700_000_003_500,
      }),
    );
    await assert.rejects(
      prepareLabelPair(target, { projectionHash: "sha256:noul", storeDir: target.dir }),
      /claim-verification only/,
    );
  });

  it("prepare refuses a group that lacks Jev or the local baseline", async () => {
    const target = freshPaths();
    const journal = createDecisionJournalStore(target.dir);
    journal.append(
      recordDecision({
        decision: "claim-verification",
        engineId: "local",
        projectionHash: "sha256:one-sided",
        outcome: { kind: "choice", choice: "supported", candidates: ["supported", "contradicted", "insufficient"] },
        latencyMs: 1,
        remote: false,
        redactionApplied: false,
        now: 1_700_000_004_000,
      }),
    );
    await assert.rejects(
      prepareLabelPair(target, { projectionHash: "sha256:one-sided", storeDir: target.dir }),
      /no valid comparison pair/,
    );
  });

  it("prepare refuses agreeing verdicts", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:same", "supported", "supported");
    await assert.rejects(
      prepareLabelPair(target, { projectionHash: "sha256:same", storeDir: target.dir }),
      /verdicts agree/,
    );
  });

  it("prepare refuses when the protected projection is unavailable", async () => {
    const target = freshPaths();
    await seedClaimPair(target, "sha256:no-proj", "supported", "insufficient");
    const storeDir = mkdtempSync(join(tmpdir(), "jev-lp-empty-"));
    tempDirs.push(storeDir);
    await assert.rejects(
      prepareLabelPair(target, { projectionHash: "sha256:no-proj", storeDir }),
      /protected experiment projection unavailable/,
    );
    assert.equal((await createOutcomeLabelStore(target.dir).readAll()).labels.length, 0);
  });

  it("prepare returns NO verdict direction and the evidence render leaks none", async () => {
    const { target, storeDir } = await seededPair("sha256:blind", "supported", "insufficient");
    const stage = await prepareLabelPair(target, { projectionHash: "sha256:blind", storeDir });
    // Structural blindness: the stage carries the projection and nothing else.
    assert.deepEqual(Object.keys(stage).sort(), ["projection", "projectionHash"]);
    assert.equal(stage.projection.claim, SUPPORTED_CLAIM);

    const evidence = renderLabelPairEvidence(stage);
    assert.match(evidence, /Evidence:/);
    assert.match(evidence, new RegExp(SUPPORTED_CLAIM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // No direction may appear before truth is entered (§18.2):
    assert.doesNotMatch(evidence, /\bJev\b|\bBaseline\b/);
    assert.doesNotMatch(evidence, /-> /);
    assert.doesNotMatch(evidence, /\bcorrect\b|\bincorrect\b/);
    // The reveal has NOT been rendered at this stage at all.
    assert.equal(evidence.includes("Truth"), false);
  });

  it("commit refuses an illegal truth, writing nothing", async () => {
    const { target, storeDir } = await seededPair("sha256:bad", "supported", "insufficient");
    await assert.rejects(
      commitLabelPair(target, { projectionHash: "sha256:bad", truth: "maybe", storeDir }),
      /--truth must be one of/,
    );
    assert.equal((await createOutcomeLabelStore(target.dir).readAll()).labels.length, 0);
  });

  it("commit refuses an already-labelled pair (a judgement is never overwritten)", async () => {
    const { target, storeDir } = await seededPair("sha256:done", "supported", "insufficient", "supported");
    await assert.rejects(
      commitLabelPair(target, { projectionHash: "sha256:done", truth: "contradicted", storeDir }),
      /already labelled/,
    );
    assert.equal((await createOutcomeLabelStore(target.dir).readAll()).labels.length, 2);
  });

  it("commit derives exactly two labels — Jev first, then baseline — and reveals them", async () => {
    const { target, storeDir } = await seededPair("sha256:truth", "supported", "insufficient");
    const result = await commitLabelPair(target, { projectionHash: "sha256:truth", truth: "supported", storeDir });
    assert.equal(result.truth, "supported");
    assert.deepEqual(
      result.labels.map((side) => [side.engineId, side.label]),
      [
        ["jev", "incorrect"],
        ["local", "correct"],
      ],
    );
    assert.equal(result.projection.claim, SUPPORTED_CLAIM);
    const stored = (await createOutcomeLabelStore(target.dir).readAll()).labels;
    assert.equal(stored.length, 2);
    assert.ok(stored.every((label) => label.note === "truth=supported"));

    const reveal = renderLabelPairReveal(result);
    assert.match(reveal, /Truth: supported/);
    assert.match(reveal, /Jev:\s+insufficient\s+-> incorrect/);
    assert.match(reveal, /Baseline:\s+supported\s+-> correct/);
  });

  it("commit derives both-wrong when neither verdict matches truth", async () => {
    const { target, storeDir } = await seededPair("sha256:bw", "supported", "contradicted");
    const result = await commitLabelPair(target, { projectionHash: "sha256:bw", truth: "insufficient", storeDir });
    assert.ok(result.labels.every((side) => side.label === "incorrect"));
    assert.equal(result.labels.length, 2);
  });

  it("--json without --truth is a usage error, raised before anything is read", async () => {
    await assert.rejects(
      dispatchJevCommand(["label-pair", "--projection-hash", "sha256:anything", "--json"], { cwd }),
      /--truth is required with --json/,
    );
  });

  it("non-interactive --truth through the CLI writes both labels and reveals them", async () => {
    // Seed into cwd so dispatchJevCommand({ cwd }) sees the pair.
    const target = resolveJevPaths(cwd);
    await seedClaimPair(target, "sha256:cli", "supported", "insufficient");
    await createExperimentProjectionStore(cwd).append({
      projectionHash: "sha256:cli",
      decision: "claim-verification",
      claim: SUPPORTED_CLAIM,
      evidence: [{ excerpt: SUPPORTED_EXCERPT }],
      createdAt: "2026-09-22T00:00:00.000Z",
    });
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      await dispatchJevCommand(
        ["label-pair", "--projection-hash", "sha256:cli", "--truth", "supported", "--store-dir", cwd, "--json"],
        { cwd },
      );
    } finally {
      (process.stdout as unknown as { write: typeof original }).write = original;
    }
    const result = JSON.parse(chunks.join("")) as { truth: string; labels: unknown[] };
    assert.equal(result.truth, "supported");
    assert.equal(result.labels.length, 2);
  });
});
```

Near the file's other helpers add:

```ts
const SUPPORTED_CLAIM = "Water boils at 100 degrees Celsius at sea level.";
const SUPPORTED_EXCERPT = "At sea level, water boils at 100 degrees Celsius.";
```

Add to imports: `prepareLabelPair`, `commitLabelPair` (ops), `renderLabelPairEvidence`, `renderLabelPairReveal` (render), `createExperimentProjectionStore` (decision barrel).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm build && node --test dist/tests/cli/jev-ops.test.js`
Expected: FAIL — `prepareLabelPair is not a function`.

- [ ] **Step 3: Implement ops**

Append to `src/cli/commands/jev/ops.ts`:

```ts
// ─── Blind ground-truth labelling (two-stage, spec §18) ────────────────

export type LabelPairStage = {
  projectionHash: string;
  projection: ClaimVerificationExperimentProjection;
};

export type LabelPairSide = { engineId: string; decisionId: string; verdict: string; label: OutcomeLabel };
export type LabelPairResult = {
  projectionHash: string;
  truth: string;
  /** Exactly two sides, fixed order: Jev, then local baseline (plan amendment 2). */
  labels: LabelPairSide[];
  projection: ClaimVerificationExperimentProjection;
};

/**
 * Shared structural validation: every refusal that reveals no verdict
 * direction fires here, so neither stage can proceed to a write on bad input.
 * Throws JevOperatorError; caller surfaces it as an operator error.
 */
function experimentPair(
  records: readonly DecisionJournalRecord[],
  projectionHash: string,
): { decision: DecisionType; jev: DecisionJournalRecord; baseline: DecisionJournalRecord } {
  const group = records.filter((record) => record.projectionHash === projectionHash);
  if (group.length === 0) {
    throw new JevOperatorError(`projectionHash unknown: ${projectionHash}`);
  }
  const decision = group[0].decision;
  if (decision !== "claim-verification") {
    throw new JevOperatorError(
      `label-pair supports claim-verification only (found ${decision}): other decisions have no protected projection store, so the §18.1 evidence view cannot be shown`,
    );
  }
  const byEngine = groupChoiceByEngine(records, decision).get(projectionHash);
  const jev = byEngine?.get(JEV_ENGINE_ID);
  const baseline = byEngine?.get(LOCAL_ENGINE_ID);
  if (jev === undefined || baseline === undefined) {
    throw new JevOperatorError(
      `no valid comparison pair exists for ${projectionHash} — need both ${JEV_ENGINE_ID} and ${LOCAL_ENGINE_ID} choice records`,
    );
  }
  const jevVerdict = String((jev.outcome as { choice: unknown }).choice);
  const baselineVerdict = String((baseline.outcome as { choice: unknown }).choice);
  if (jevVerdict === baselineVerdict) {
    throw new JevOperatorError("pair verdicts agree — use alix jev label for single-record labelling");
  }
  return { decision, jev, baseline };
}

/**
 * Stage 1 — structural validation plus the operator's evidence view (§18.1).
 * The returned type is deliberately projection-only: no verdict crosses this
 * boundary, which is what makes blindness structural rather than cosmetic
 * (§18.2). Verdicts are read only inside commitLabelPair, after truth exists.
 */
export async function prepareLabelPair(
  paths: JevPaths,
  input: { projectionHash: string; storeDir?: string },
): Promise<LabelPairStage> {
  const records = createDecisionJournalStore(paths.dir).readAll();
  experimentPair(records, input.projectionHash); // validates; verdicts discarded
  const projection = await createExperimentProjectionStore(input.storeDir).readByHash(input.projectionHash);
  if (projection === undefined) {
    throw new JevOperatorError(`protected experiment projection unavailable for ${input.projectionHash}`);
  }
  return { projectionHash: input.projectionHash, projection };
}

/**
 * Stage 2 — after truth is entered. Re-runs structural validation (idempotent),
 * then truth legality and already-labelled refusals, then derives both labels
 * from `truth` (§18.3) and appends them (§18.4: every refusal fires before the
 * first append).
 */
export async function commitLabelPair(
  paths: JevPaths,
  input: { projectionHash: string; truth: string; storeDir?: string },
): Promise<LabelPairResult> {
  const records = createDecisionJournalStore(paths.dir).readAll();
  const { decision, jev, baseline } = experimentPair(records, input.projectionHash);

  if (!(CLAIM_VERDICT_CANDIDATES as readonly string[]).includes(input.truth)) {
    throw new JevOperatorError(`--truth must be one of ${CLAIM_VERDICT_CANDIDATES.join("|")}`);
  }
  const projection = await createExperimentProjectionStore(input.storeDir).readByHash(input.projectionHash);
  if (projection === undefined) {
    throw new JevOperatorError(`protected experiment projection unavailable for ${input.projectionHash}`);
  }

  const labelStore = createOutcomeLabelStore(paths.dir);
  const existing = indexLabelsByDecisionId((await labelStore.readAll()).labels);
  for (const record of [jev, baseline]) {
    if (existing.has(record.decisionId)) {
      throw new JevOperatorError(`already labelled: ${record.decisionId} — a judgement is never overwritten`);
    }
  }

  const labels: LabelPairSide[] = [];
  for (const record of [jev, baseline]) {
    const verdict = String((record.outcome as { choice: unknown }).choice);
    const label = verdict === input.truth ? "correct" : "incorrect";
    await labelStore.append(
      createOutcomeLabel({
        decisionId: record.decisionId,
        decision,
        label,
        note: `truth=${input.truth}`,
        observedAt: Date.now(),
      }),
    );
    labels.push({ engineId: record.engineId, decisionId: record.decisionId, verdict, label });
  }

  return { projectionHash: input.projectionHash, truth: input.truth, labels, projection };
}
```

Add imports as needed: `CLAIM_VERDICT_CANDIDATES` (drop any `RISK_TIER_CANDIDATES`/`MODEL_TIER_VALUES` plan — they are out of scope, plan amendment 4), `ClaimVerificationExperimentProjection`, `createExperimentProjectionStore`, `JEV_ENGINE_ID`, `LOCAL_ENGINE_ID` (the last two are already imported for Task 6).

- [ ] **Step 4: Implement render**

Append to `src/cli/commands/jev/render.ts`:

```ts
/**
 * Stage 1 output — claim + evidence only (§18.1). MUST NOT contain verdict
 * direction: no engine names, no verdict words, no arrows, no "Truth" (§18.2).
 * tests/cli/jev-ops.test.ts pins these absences.
 */
export function renderLabelPairEvidence(stage: LabelPairStage): string {
  const lines: string[] = [
    `Evidence for ${stage.projectionHash}`,
    "",
    "Claim:",
    `  ${stage.projection.claim}`,
    "",
    "Evidence:",
  ];
  if (stage.projection.evidence.length === 0) {
    lines.push("  (none)");
  }
  stage.projection.evidence.forEach((item, index) => {
    if (item.source !== undefined) lines.push(`  [${index + 1}] ${item.source}`);
    lines.push(`  [${index + 1}] ${item.excerpt}`);
  });
  return lines.join("\n");
}

/**
 * Stage 2 output — only ever called AFTER truth is committed (§18: "after truth
 * is committed, the CLI may reveal truth, verdicts, derived labels").
 */
export function renderLabelPairReveal(result: LabelPairResult): string {
  const lines: string[] = [`Truth: ${result.truth}`, ""];
  for (const side of result.labels) {
    const name = side.engineId === "jev" ? "Jev" : "Baseline";
    lines.push(`${name}:`.padEnd(10) + side.verdict.padEnd(15) + `-> ${side.label}`);
  }
  return lines.join("\n");
}
```

Add `LabelPairStage`, `LabelPairResult` to `render.ts`'s `./ops.js` imports.

- [ ] **Step 5: Implement dispatch (two-stage)**

In `src/cli/commands/jev/main.ts`, add before `default:`:

```ts
    case "label-pair": {
      const flags = parseKeyValueArgs(rest, ["projection-hash", "truth", "store-dir"], ["json"]);
      const projectionHash = requireString(flags["projection-hash"], "projection-hash");
      const storeDir = typeof flags["store-dir"] === "string" ? { storeDir: flags["store-dir"] } : {};
      const hasTruth = typeof flags.truth === "string" && flags.truth.length > 0;

      // Usage check first: --json is automation, so it must carry truth.
      if (json && !hasTruth) {
        throw new JevOperatorError(
          "--truth is required with --json (interactive prompting is TTY-only; supply truth established independently)",
        );
      }

      // Stage 1: structural refusals + the evidence view. No verdict direction.
      const stage = await prepareLabelPair(paths, { projectionHash, ...storeDir });

      if (hasTruth) {
        // Non-interactive path: caller already established truth independently.
        const result = await commitLabelPair(paths, { projectionHash, truth: flags.truth as string, ...storeDir });
        out(json ? JSON.stringify(result, null, 2) : renderLabelPairReveal(result));
        return;
      }

      out(renderLabelPairEvidence(stage));
      const raw = await promptUser(`Truth [${CLAIM_VERDICT_CANDIDATES.join("|")}]: `);
      const result = await commitLabelPair(paths, {
        projectionHash,
        truth: raw.trim().toLowerCase(),
        ...storeDir,
      });
      out(renderLabelPairReveal(result));
      return;
    }
```

Add imports: `prepareLabelPair`, `commitLabelPair` (ops), `renderLabelPairEvidence`, `renderLabelPairReveal` (render), `CLAIM_VERDICT_CANDIDATES` (decision barrel — main.ts already imports decision types), `promptUser` from `../../../run/helpers.js`. Extend the unknown-subcommand list with `label-pair`.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm build && node --test dist/tests/cli/jev-ops.test.js`
Expected: PASS — including the refusal-before-write assertions.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/jev/ops.ts src/cli/commands/jev/render.ts src/cli/commands/jev/main.ts tests/cli/jev-ops.test.ts
git commit -m "feat(jev-cli): blind label-pair derives two labels from one truth"
```

---

### Task 8: Verification + DOX closeout

**Files:**
- Modify: `src/decision/decisions/claim-verification/AGENTS.md`
- Modify: `src/decision/AGENTS.md`
- Modify: `src/cli/commands/jev/AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: an up-to-date DOX chain and a green tree; no behaviour change.

- [ ] **Step 1: Run the full verification**

```bash
pnpm build
node --test dist/tests/config/decision-section.test.js dist/tests/decision/claim-verification.test.js dist/tests/tools/capability-map.test.js dist/tests/tools/tool-registry.test.js dist/tests/tools/claim-verification-tool.test.js dist/tests/cli/jev-ops.test.js dist/tests/decision/decision-foundation.test.js dist/tests/decision/decision-fallback.test.js dist/tests/decision/decision-journal.test.js
pnpm typecheck:unused
pnpm check:dead
```
Expected: all PASS, `OK: every src module is imported or allowlisted.`

- [ ] **Step 2: Canary the two one-line seams tests cannot reach**

```bash
grep -q 'readOnlyToolFilter.add("alix_verify_claim")' src/agent/agent-loop.ts && \
grep -q 'new ClaimVerificationToolRouter(this.root)' src/tools/executor.ts && echo "wiring seams present"
```
Expected: `wiring seams present`

- [ ] **Step 3: Update the DOX chain**

`src/decision/decisions/claim-verification/AGENTS.md` — Ownership gains:
- `selection-service.ts` — `selectClaimVerification` (`baseline` | `shadow` | `active`); **divergence: unlike `selectModelTier`/`selectRiskTier`, `shadow` returns the baseline verdict**, because the tool's entire response is the verdict (spec §10).
- `experiment-store.ts` — protected projection store at `~/.alix/decisions/experiments.jsonl` via `storeDir ?? join(homedir(), ".alix")` + shared `JsonlStore`; the journal keeps only `projectionHash`, so this is what an operator judges from (§16).

Local Contracts gain: mode default `baseline` (renamed from `off`, §3.1); model payload is exactly `{verdict, engine, decisionId?, authority:"none", warning?}`; boundary rejection degrades to a local verdict with `warning` and **no** record (no seal ⇒ no hash).

`src/decision/AGENTS.md` — ownership line for `decisions/claim-verification/` gains `selection-service`/`experiment-store`; add `paths.ts` (decision-owned paths so tools never import `src/cli/commands/*`) to the ownership list.

`src/cli/commands/jev/AGENTS.md` — Commands gain:
- `disagreements [--decision <d>] [--json]` — pairs by `projectionHash` (most recent Choice record per engine), footer with `invocations/paired/comparable_pairs/agreements/disagreements/disagreement_rate` + `jev_correct/baseline_correct/both_wrong`; prints `no disagreement data available` when `paired=0` (distinct from "the engines always agree", spec §11).
- `label-pair --projection-hash <hash> --truth <v> [--store-dir <dir>] [--json]` — one truth, two derived labels, `note: truth=<v>`; refuses (writes nothing) on unknown hash / no pair / agreeing verdicts / illegal truth / already-labelled / missing projection. Requires the protected experiment store; Noul decisions are refused.

- [ ] **Step 4: Commit**

```bash
git add src/decision/decisions/claim-verification/AGENTS.md src/decision/AGENTS.md src/cli/commands/jev/AGENTS.md
git commit -m "docs(dox): record selection service, experiment store, jev subcommands"
```

- [ ] **Step 5: Run `detect_changes` before any final commit or PR**

Run the `gitnexus_detect_changes` tool with `scope: "unstaged"` (and `staged` when staged). Expect low risk, decision/tools/CLI symbols only, no `policy`/`providers`/`kernel` symbols. **A "No changes detected" result for a brand-new untracked file means the file is not staged — confirm with `git status`.**

- [ ] **Step 6: Push the eight commits and open the PR (plan amendment 3)**

The branch exists from Preflight Step 0.2 and every task already committed to
it — so **no** `git add <every file>` and **no** `git commit --amend`: one
commit per task stands exactly as written in Tasks 1–8.

```bash
git log --oneline origin/main..HEAD   # expect 8 commits, one per task
git status --short                    # nothing unstaged
git push -u origin feat/claim-verification-shadow-tool
gh pr create --base main --head feat/claim-verification-shadow-tool \
  --title "feat(tools): alix_verify_claim — claim-verification primitive with Jev shadow experiment" \
  --body "$(printf '%s\n' \
    'Implements docs/superpowers/specs/2026-09-22-claim-verification-shadow-tool-design.md (approved; amendments in §3.1) via docs/superpowers/plans/2026-09-22-claim-verification-shadow-tool.md (8 tasks, one commit each).' \
    '' \
    'Adds selectClaimVerification (baseline|shadow|active), the protected experiment projection store at ~/.alix/decisions/experiments.jsonl, the verify.claim tool with its full seven-edit wiring, `alix jev disagreements`, and two-stage blind `alix jev label-pair` (claim-verification only).' \
    '' \
    'Verification: pnpm build; decision/config/cli/policy/tools suites; typecheck:unused; check:dead — all green. detect_changes reviewed before the PR.')"
```

Expected: PR opened with 8 commits, CI running.

---

## Spec Coverage (self-review)

| Spec section | Task |
|---|---|
| §3 / §3.1 locked decisions, mode `baseline` | 1, 2 |
| §4 JEV-1..JEV-10 (inherited; boundary/fallback already tested) | 4 (degrades), existing suites |
| §5 components | 2, 3, 4, 5 |
| §6 config + validator | 1 |
| §7 wiring + §7.1 approval trap | 5 (test pins `≠ tool.invoke`) |
| §8 tool contract, §8.2 validation bounds, §8.3 payload hiding | 4 (tests assert key set has no `agree`) |
| §9 data flow, §10 modes, §10.1 divergence | 2, 4 |
| §11 preconditions / "no data available" wording | 6 (render) |
| §12 boundary failure, §13 remote failure, §14 journal failure | 4 (three dedicated tests) |
| §15 pairing rules | 6 (`groupChoiceByEngine`, most-recent-per-engine test) |
| §16 + §16.4 store | 3 (+4 writes it) |
| §17 disagreements CLI + §17.2 rate/denominator | 6 |
| §18 blind labelling — genuinely **two-stage** (evidence+prompt before commit), refusals, derivation | 7 (amendment 1) |
| §18.5 scope narrowed to claim-verification (no protected store for other decisions yet) | 7 (amendment 4) |
| Plan amendments 1–4 (two-stage blindness; Jev+local-only pairing; branch preflight; claim-only scope) | Preflight, 6, 7 |
| §18 blind labelling, refusals, derivation, scope | 7 |
| §19/§20 metrics + gate (informational) | 6 footer |
| §22/§23 failure + security matrix | 4, 5 (tests), inherited |
| §24 testing | every task |
| §25 verification | 8 |
| §26 out of scope | no task touches routing/approvals/other decisions |
| §27 acceptance | 5 (no approval prompt), 4 (authority/payload), 6+7 (criterion executable) |
| §28 implementation order | task order 1→8 follows it |
| §29 stop conditions | Global Constraints + no task violates them |

Not in scope by design: recording the experiment's *outcome* in `docs/jev/ALiX-Jev-Status.md` (spec §8 — that happens after ≥30 paired invocations exist, not at build time).
