# A5.1 Outcome Observation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the A5 Observation Engine — post-execution system observation that produces `VerificationEvidence { evidenceClass: "observed" }`.

**Architecture:** ObservationEngine dispatches `Observation` definitions to registered `ObservationProvider` instances by the `provider` string routing key. Providers return `ObservationResult` atoms. A bridge aggregates results into standard `VerificationEvidence` compatible with A3 governance. Four V1 providers (CLI, Filesystem, Git, Ledger).

**Tech Stack:** TypeScript, Node.js `child_process.execFile`, `crypto.createHash`, `fs/promises`, `execa` or raw `child_process`.

## Global Constraints

- All new files must have SPDX header: `// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>\n// SPDX-License-Identifier: MIT`
- All imports from other TypeScript files must use `.js` extension
- Providers MUST never throw — catch all exceptions and return `{ status: "error" }` results
- Providers MUST never mutate the system — read-only operations only
- `Observation.provider` is the only runtime routing key — never scan providers by capability
- `observeAll()` MUST preserve input ordering in output for deterministic evidence hashing
- Branch: `feat/a5-outcome-observation` (tracking `origin/main`)
- Tests mirror source at `tests/evolution/observation/`
- All test files import from `../../../src/evolution/observation/...` using `.js` extensions

---

## File Structure

```
src/evolution/observation/
├── contracts/
│   └── observation-contract.ts     — Observation, ObservationResult, ObservationProvider
├── observation-engine.ts            — ObservationEngine class
├── providers/
│   ├── cli-provider.ts              — CLI Provider
│   ├── filesystem-provider.ts       — Filesystem Provider
│   ├── git-provider.ts              — Git Provider
│   └── ledger-provider.ts           — Ledger Provider
├── observation-evidence-bridge.ts   — buildObservationEvidence()
├── observation-cli.ts               — CLI handler
└── index.ts                         — Barrel exports
tests/evolution/observation/
├── observation-contract.test.ts
├── observation-engine.test.ts
├── providers/
│   ├── cli-provider.test.ts
│   ├── filesystem-provider.test.ts
│   ├── git-provider.test.ts
│   └── ledger-provider.test.ts
├── observation-evidence-bridge.test.ts
├── observation-cli.test.ts
└── integration/
    └── observation-integration.test.ts
```

**Modified files (outside observation/):**
- `src/governance/evolution-cli.ts` — add `observe` case + help text + import

---

### Task 1: Core Contracts

**Files:**
- Create: `src/evolution/observation/contracts/observation-contract.ts`
- Test: `tests/evolution/observation/observation-contract.test.ts`

**Interfaces:**
- Produces: `Observation`, `ObservationResult`, `ObservationStatus`, `ObservationProvider`
- Produces: `validateObservation()`, `validateObservationResult()`
- Consumes: (none — first task)

- [ ] **Step 1: Write the contract file**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Contract Types.
 *
 * Core artifact types for the A5 Observation Engine. Defines the
 * observation definition (what to measure), the observation result
 * (what was measured), and the provider contract (how to measure).
 *
 * @module observation-contract
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// ObservationStatus
// ---------------------------------------------------------------------------

export type ObservationStatus = "pass" | "fail" | "error" | "inconclusive";

export const VALID_OBSERVATION_STATUSES: readonly ObservationStatus[] = [
  "pass",
  "fail",
  "error",
  "inconclusive",
];

// ---------------------------------------------------------------------------
// Observation (definition)
// ---------------------------------------------------------------------------

export interface Observation {
  /** Unique identifier for this observation. */
  readonly observationId: string;
  /** Provider routing key — must match a registered ObservationProvider.name. */
  readonly provider: string;
  /** Human-readable description of what is being measured. */
  readonly description: string;
  /** Optional expected value for verification-style observations. */
  readonly expected?: unknown;
  /** Provider-specific configuration parameters. */
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ObservationResult
// ---------------------------------------------------------------------------

export interface ObservationResult {
  /** Matches the originating Observation.observationId. */
  readonly observationId: string;
  /** Outcome of this observation measurement. */
  readonly status: ObservationStatus;
  /** Confidence in THIS measurement (0-1), not a provider-level reliability score. */
  readonly confidence: number;
  /** When the measurement was taken (ISO 8601). */
  readonly observedAt: string;
  /** The expected value (copied from Observation if provided). */
  readonly expected?: unknown;
  /** The observed value (may be absent on error/inconclusive). */
  readonly observed?: unknown;
  /** Provider-specific raw evidence artifacts. */
  readonly evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ObservationProvider
// ---------------------------------------------------------------------------

export interface ObservationProvider {
  /** Unique provider name (used as the Observation.provider routing key). */
  readonly name: string;
  /** Descriptive capability tags for discovery/diagnostics. */
  readonly capabilities: readonly string[];
  /** Optional validation guard — not for runtime dispatch. */
  canObserve?(observation: Observation): boolean;
  /**
   * Execute the observation.
   *
   * @invariant MUST return an ObservationResult, never throw.
   * @invariant MUST NOT mutate the system.
   */
  observe(observation: Observation): Promise<ObservationResult>;
}

// ---------------------------------------------------------------------------
// Validator helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateObservation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Observation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.observationId)) errors.push("observationId required and must be non-empty");
  if (!isNonEmptyString(v.provider)) errors.push("provider required and must be non-empty");
  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

export function validateObservationResult(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ObservationResult must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.observationId)) errors.push("observationId required and must be non-empty");

  if (typeof v.status !== "string" || !(VALID_OBSERVATION_STATUSES as readonly string[]).includes(v.status as string)) {
    errors.push(`status must be one of: ${VALID_OBSERVATION_STATUSES.join(", ")}`);
  }

  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }

  if (!isNonEmptyString(v.observedAt)) errors.push("observedAt required and must be non-empty");

  if (typeof v.evidence !== "object" || v.evidence === null || Array.isArray(v.evidence)) {
    errors.push("evidence required and must be a non-null object");
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Write the contract tests**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateObservation,
  validateObservationResult,
  type Observation,
  type ObservationResult,
} from "../../../src/evolution/observation/contracts/observation-contract.js";

describe("validateObservation", () => {
  it("accepts a valid observation", () => {
    const obs: Observation = {
      observationId: "obs-1",
      provider: "cli",
      description: "Check system status",
    };
    assert.ok(validateObservation(obs).valid);
  });

  it("accepts observation with optional expected and params", () => {
    const obs: Observation = {
      observationId: "obs-2",
      provider: "filesystem",
      description: "File exists",
      expected: "exists",
      params: { path: "/tmp/test.txt" },
    };
    assert.ok(validateObservation(obs).valid);
  });

  it("rejects when observationId is empty", () => {
    const result = validateObservation({ observationId: "", provider: "cli", description: "test" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("observationId")));
  });

  it("rejects when provider is missing", () => {
    const result = validateObservation({ observationId: "obs-1", description: "test" } as Observation);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("provider")));
  });

  it("rejects when description is missing", () => {
    const result = validateObservation({ observationId: "obs-1", provider: "cli" } as Observation);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("description")));
  });
});

describe("validateObservationResult", () => {
  const validResult: ObservationResult = {
    observationId: "obs-1",
    status: "pass",
    confidence: 1.0,
    observedAt: "2026-07-12T00:00:00Z",
    evidence: { key: "value" },
  };

  it("accepts a valid result", () => {
    assert.ok(validateObservationResult(validResult).valid);
  });

  it("accepts result with optional expected and observed", () => {
    const result: ObservationResult = {
      ...validResult,
      expected: "pass",
      observed: "pass",
    };
    assert.ok(validateObservationResult(result).valid);
  });

  it("rejects when status is invalid", () => {
    const result = validateObservationResult({ ...validResult, status: "invalid" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes("status")));
  });

  it("rejects when confidence is out of range", () => {
    const tooLow = validateObservationResult({ ...validResult, confidence: -0.1 });
    assert.ok(!tooLow.valid);
    const tooHigh = validateObservationResult({ ...validResult, confidence: 1.1 });
    assert.ok(!tooHigh.valid);
  });

  it("rejects when observedAt is empty", () => {
    const result = validateObservationResult({ ...validResult, observedAt: "" });
    assert.ok(!result.valid);
  });

  it("rejects when evidence is not an object", () => {
    const result = validateObservationResult({ ...validResult, evidence: "string" });
    assert.ok(!result.valid);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx tsx --test tests/evolution/observation/observation-contract.test.ts
```

Expected: FAIL with module-not-found errors (file doesn't exist yet)

- [ ] **Step 4: Create src directory structure**

```bash
mkdir -p src/evolution/observation/contracts
mkdir -p src/evolution/observation/providers
mkdir -p tests/evolution/observation/providers
mkdir -p tests/evolution/observation/integration
```

- [ ] **Step 5: Write the contract file** (use code from Step 1)

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx tsx --test tests/evolution/observation/observation-contract.test.ts
```

Expected: ALL tests pass

- [ ] **Step 7: Commit**

```bash
git add src/evolution/observation/contracts/observation-contract.ts tests/evolution/observation/observation-contract.test.ts
git commit -m "feat(A5): add observation contract types

Define Observation, ObservationResult, ObservationProvider interfaces
with validators. Observation uses deterministic provider routing key.
ObservationResult captures status, confidence, timestamps, and evidence.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ObservationEngine

**Files:**
- Create: `src/evolution/observation/observation-engine.ts`
- Test: `tests/evolution/observation/observation-engine.test.ts`

**Interfaces:**
- Consumes: `Observation`, `ObservationResult`, `ObservationProvider` from Task 1
- Produces: `ObservationEngine` class with `register()`, `observe()`, `observeAll()`, `getProvider()`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ObservationEngine } from "../../../src/evolution/observation/observation-engine.js";
import type { Observation, ObservationResult, ObservationProvider } from "../../../src/evolution/observation/contracts/observation-contract.js";

function makeMockProvider(name: string): ObservationProvider {
  return {
    name,
    capabilities: ["test"],
    observe: mock.fn(async (obs: Observation): Promise<ObservationResult> => ({
      observationId: obs.observationId,
      status: "pass",
      confidence: 1.0,
      observedAt: "2026-07-12T00:00:00Z",
      evidence: {},
    })),
  };
}

describe("ObservationEngine", () => {
  it("registers a provider", () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("test"));
    assert.ok(engine.getProvider("test"));
  });

  it("throws on duplicate provider registration", () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("test"));
    assert.throws(() => engine.register(makeMockProvider("test")), /already registered/);
  });

  it("returns error result for unknown provider", async () => {
    const engine = new ObservationEngine();
    const result = await engine.observe({ observationId: "obs-1", provider: "unknown", description: "test" });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("dispatches to registered provider by name", async () => {
    const engine = new ObservationEngine();
    const provider = makeMockProvider("cli");
    engine.register(provider);

    const obs: Observation = { observationId: "obs-1", provider: "cli", description: "test" };
    const result = await engine.observe(obs);

    assert.equal(result.status, "pass");
    assert.equal(result.observationId, "obs-1");
    assert.equal((provider.observe as mock.Mock<typeof provider.observe>).mock.callCount(), 1);
  });

  it("wraps provider exception into error result", async () => {
    const engine = new ObservationEngine();
    const throwingProvider: ObservationProvider = {
      name: "broken",
      capabilities: ["test"],
      observe: mock.fn(async () => { throw new Error("Internal failure"); }),
    };
    engine.register(throwingProvider);

    const result = await engine.observe({ observationId: "obs-1", provider: "broken", description: "test" });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
    assert.ok(result.evidence.errorType === "provider_exception");
  });

  it("observeAll preserves input ordering", async () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("a"));
    engine.register(makeMockProvider("b"));

    const results = await engine.observeAll([
      { observationId: "obs-a", provider: "a", description: "A" },
      { observationId: "obs-b", provider: "b", description: "B" },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].observationId, "obs-a");
    assert.equal(results[1].observationId, "obs-b");
  });

  it("observeAll returns error for unknown providers without crashing", async () => {
    const engine = new ObservationEngine();
    engine.register(makeMockProvider("a"));

    const results = await engine.observeAll([
      { observationId: "obs-1", provider: "a", description: "A" },
      { observationId: "obs-2", provider: "unknown", description: "B" },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].status, "pass");
    assert.equal(results[1].status, "error");
  });

  it("getProvider returns undefined for unregistered name", () => {
    const engine = new ObservationEngine();
    assert.equal(engine.getProvider("nonexistent"), undefined);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/observation-engine.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the ObservationEngine**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Engine.
 *
 * Orchestrates observation dispatch to registered providers. Handles
 * provider lookup, exception containment, and bounded concurrency.
 *
 * @module observation-engine
 */

import type { Observation, ObservationResult, ObservationProvider } from "./contracts/observation-contract.js";

// ---------------------------------------------------------------------------
// EngineConfig
// ---------------------------------------------------------------------------

export interface EngineConfig {
  /** Maximum concurrent observations (default: 4). */
  maxConcurrency: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxConcurrency: 4,
};

// ---------------------------------------------------------------------------
// ObservationEngine
// ---------------------------------------------------------------------------

export class ObservationEngine {
  private readonly providers = new Map<string, ObservationProvider>();
  private readonly config: EngineConfig;

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  /**
   * Register a provider.
   * @throws {Error} If a provider with the same name is already registered.
   */
  register(provider: ObservationProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a registered provider by name.
   */
  getProvider(name: string): ObservationProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Execute a single observation.
   * Always returns an ObservationResult — never throws.
   */
  async observe(observation: Observation): Promise<ObservationResult> {
    const provider = this.providers.get(observation.provider);
    if (!provider) {
      return unknownProviderResult(observation);
    }

    try {
      return await provider.observe(observation);
    } catch (err) {
      return exceptionResult(observation, err);
    }
  }

  /**
   * Execute multiple observations with bounded concurrency.
   *
   * @invariant Result ordering matches input ordering for deterministic hashing.
   */
  async observeAll(observations: Observation[]): Promise<ObservationResult[]> {
    const results: (ObservationResult | null)[] = new Array(observations.length);
    const running = new Set<number>();
    let nextIndex = 0;

    const startNext = (): Promise<void> => {
      if (nextIndex >= observations.length) return Promise.resolve();

      const idx = nextIndex++;
      running.add(idx);

      return this.observe(observations[idx]).then((result) => {
        results[idx] = result;
        running.delete(idx);
        return startNext();
      });
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(this.config.maxConcurrency, observations.length);
    for (let i = 0; i < workerCount; i++) {
      workers.push(startNext());
    }

    await Promise.all(workers);

    return results.filter((r): r is ObservationResult => r !== null);
  }
}

// ---------------------------------------------------------------------------
// Internal error result builders
// ---------------------------------------------------------------------------

function unknownProviderResult(observation: Observation): ObservationResult {
  return {
    observationId: observation.observationId,
    status: "error",
    confidence: 0,
    observedAt: new Date().toISOString(),
    evidence: {
      errorType: "environment_failure",
      message: `Unknown provider: ${observation.provider}`,
    },
  };
}

function exceptionResult(observation: Observation, err: unknown): ObservationResult {
  return {
    observationId: observation.observationId,
    status: "error",
    confidence: 0,
    observedAt: new Date().toISOString(),
    evidence: {
      errorType: "provider_exception",
      message: String(err),
    },
  };
}
```

- [ ] **Step 4: Write the implementation** (use code from Step 3)

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx tsx --test tests/evolution/observation/observation-engine.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/observation-engine.ts tests/evolution/observation/observation-engine.test.ts
git commit -m "feat(A5): add ObservationEngine with provider dispatch

ObservationEngine routes observations to registered providers by
Observation.provider string key. Handles exception containment,
unknown provider errors, concurrent execution with ordering guarantee.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: CLI Provider

**Files:**
- Create: `src/evolution/observation/providers/cli-provider.ts`
- Test: `tests/evolution/observation/providers/cli-provider.test.ts`

**Interfaces:**
- Consumes: `Observation`, `ObservationResult`, `ObservationProvider` from Task 1
- Produces: `CliObservationProvider` implementing `ObservationProvider`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CliObservationProvider } from "../../../../src/evolution/observation/providers/cli-provider.js";

describe("CliObservationProvider", () => {
  const provider = new CliObservationProvider();

  it("has name 'cli'", () => {
    assert.equal(provider.name, "cli");
  });

  it("has cli capability", () => {
    assert.ok(provider.capabilities.includes("cli"));
  });

  it("captures exit code 0 as pass", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "cli",
      description: "Echo test",
      params: { command: "node", args: ["-e", "process.exit(0)"] },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.confidence, 1.0);
    assert.equal(result.evidence.exitCode, 0);
  });

  it("captures exit code 1 as fail when expected is 0", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "cli",
      description: "Failing command",
      expected: 0,
      params: { command: "node", args: ["-e", "process.exit(1)"] },
    });
    assert.equal(result.status, "fail");
    assert.equal(result.evidence.exitCode, 1);
  });

  it("sets status to pass when no expected value (reality capture)", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "cli",
      description: "Capture stdout",
      params: { command: "node", args: ["-e", "console.log('hello')"] },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "string");
  });

  it("captures stdout and stderr in evidence", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "cli",
      description: "Test output",
      params: { command: "node", args: ["-e", "console.log('out'); console.error('err')"] },
    });
    assert.equal(result.evidence.stdout, "out\n");
    assert.equal(result.evidence.stderr, "err\n");
  });

  it("returns error when command not found", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "cli",
      description: "Nonexistent",
      params: { command: "nonexistent-command-xyz" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("returns error result (never throws) on invalid command", async () => {
    // Should not throw — should return error result
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "cli",
      description: "Invalid",
      params: { command: "" },
    });
    assert.equal(result.status, "error");
  });

  it("downgrades confidence on stderr output", async () => {
    const result = await provider.observe({
      observationId: "obs-7",
      provider: "cli",
      description: "Stderr warning",
      params: { command: "node", args: ["-e", "console.error('warn')"] },
    });
    // stderr present → confidence < 1.0
    assert.ok(result.confidence < 1.0);
    assert.ok(result.confidence > 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/providers/cli-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the CLI provider**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — CLI Observation Provider.
 *
 * Observes system state by executing shell commands and capturing
 * exit codes, stdout, and stderr. Never mutates the system.
 *
 * @module cli-provider
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// CliObservationProvider
// ---------------------------------------------------------------------------

export class CliObservationProvider implements ObservationProvider {
  readonly name = "cli";
  readonly capabilities = ["cli"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const command = params?.command as string | undefined;
    const args = (params?.args as string[]) ?? [];

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: { errorType: "environment_failure", message: "No command specified" },
      };
    }

    try {
      const { stdout, stderr, exitCode } = await execFileAsync(command, args, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });

      let confidence = 1.0;
      const hasStderr = stderr.length > 0;

      // Downgrade confidence based on measurement quality — not output cleanliness
      if (hasStderr) {
        // stderr may contain diagnostics affecting reliability
        confidence *= 0.9;
      }

      // Determine status
      const expected = observation.expected;
      let status: "pass" | "fail" | "error" | "inconclusive";

      if (expected !== undefined) {
        status = exitCode === expected ? "pass" : "fail";
      } else {
        // Reality capture — always pass at the observation layer
        status = "pass";
      }

      return {
        observationId: observation.observationId,
        status,
        confidence,
        observedAt: new Date().toISOString(),
        expected: observation.expected,
        observed: exitCode,
        evidence: { command, args, exitCode, stdout, stderr, hasStderr },
      };
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "environment_failure",
          message: nodeErr.code === "ENOENT"
            ? `Command not found: ${command}`
            : nodeErr.message ?? String(err),
          code: nodeErr.code,
        },
      };
    }
  }
}
```

- [ ] **Step 4: Write the implementation** (use code from Step 3)

- [ ] **Step 5: Run tests**

```bash
npx tsx --test tests/evolution/observation/providers/cli-provider.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/providers/cli-provider.ts tests/evolution/observation/providers/cli-provider.test.ts
git commit -m "feat(A5): add CLI observation provider

CLI Provider executes commands via execFile, captures exit code,
stdout, stderr. Supports verification (compare exit code to expected)
and reality capture (always pass with captured output). Never throws.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Filesystem Provider

**Files:**
- Create: `src/evolution/observation/providers/filesystem-provider.ts`
- Test: `tests/evolution/observation/providers/filesystem-provider.test.ts`

**Interfaces:**
- Consumes: `Observation`, `ObservationResult`, `ObservationProvider` from Task 1
- Produces: `FilesystemObservationProvider` implementing `ObservationProvider`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemObservationProvider } from "../../../../src/evolution/observation/providers/filesystem-provider.js";

describe("FilesystemObservationProvider", () => {
  const provider = new FilesystemObservationProvider();
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "a5-fs-test-"));
    writeFileSync(join(tmpDir, "test.txt"), "hello world");
    mkdirSync(join(tmpDir, "subdir"));
    writeFileSync(join(tmpDir, "subdir", "nested.txt"), "nested");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'filesystem'", () => {
    assert.equal(provider.name, "filesystem");
  });

  it("checks file exists (pass)", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "filesystem",
      description: "File exists",
      params: { path: join(tmpDir, "test.txt"), check: "exists" },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.confidence, 1.0);
  });

  it("checks file exists (fail)", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "filesystem",
      description: "File missing",
      expected: true,
      params: { path: join(tmpDir, "nonexistent.txt"), check: "exists" },
    });
    assert.equal(result.status, "fail");
  });

  it("computes file hash", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "filesystem",
      description: "File hash",
      params: { path: join(tmpDir, "test.txt"), check: "hash" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "string");
    // SHA-256 of "hello world" is known
    assert.equal(result.observed, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("gets file stat", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "filesystem",
      description: "File stat",
      params: { path: join(tmpDir, "test.txt"), check: "stat" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.evidence.size, "number");
    assert.equal(result.evidence.size, 11); // "hello world".length
  });

  it("returns error for nonexistent path", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "filesystem",
      description: "Nonexistent",
      params: { path: "/nonexistent/path/xyz", check: "exists" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "filesystem",
      description: "Invalid",
      params: { path: "/tmp", check: "invalid" },
    });
    assert.equal(result.status, "error");
  });

  it("reality capture returns pass with file info", async () => {
    const result = await provider.observe({
      observationId: "obs-7",
      provider: "filesystem",
      description: "Capture directory",
      params: { path: tmpDir, check: "exists" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "boolean");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/providers/filesystem-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the Filesystem provider**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Filesystem Observation Provider.
 *
 * Observes filesystem state: file existence, content hashes, and stat
 * metadata. Never mutates the filesystem.
 *
 * @module filesystem-provider
 */

import { access, stat, readFile, constants } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

// ---------------------------------------------------------------------------
// FilesystemObservationProvider
// ---------------------------------------------------------------------------

export class FilesystemObservationProvider implements ObservationProvider {
  readonly name = "filesystem";
  readonly capabilities = ["filesystem"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const path = params?.path as string | undefined;
    const check = (params?.check as string) ?? "exists";

    if (!path || typeof path !== "string") {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: { errorType: "environment_failure", message: "path parameter required" },
      };
    }

    try {
      switch (check) {
        case "exists": {
          let exists = true;
          try {
            await access(path, constants.F_OK);
          } catch {
            exists = false;
          }
          return this.buildResult(observation, exists, { path, check, exists });
        }

        case "hash": {
          const content = await readFile(path);
          const hash = createHash("sha256").update(content).digest("hex");
          return this.buildResult(observation, hash, { path, check, hash });
        }

        case "stat": {
          const stats = await stat(path);
          const statInfo = {
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            mtimeMs: stats.mtimeMs,
            mode: stats.mode,
          };
          return this.buildResult(observation, statInfo.size, { path, check, ...statInfo });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}`, path },
          };
      }
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "environment_failure",
          message: (err as Error).message ?? String(err),
          path,
        },
      };
    }
  }

  private buildResult(
    observation: Observation,
    observed: unknown,
    evidence: Record<string, unknown>,
  ): ObservationResult {
    const expected = observation.expected;
    let status: "pass" | "fail" | "error" | "inconclusive";

    if (expected !== undefined) {
      status = observed === expected ? "pass" : "fail";
    } else {
      status = "pass";
    }

    return {
      observationId: observation.observationId,
      status,
      confidence: 1.0,
      observedAt: new Date().toISOString(),
      expected,
      observed,
      evidence,
    };
  }
}
```

- [ ] **Step 4: Write the Fs provider** (use code from Step 3)

- [ ] **Step 5: Run tests**

```bash
npx tsx --test tests/evolution/observation/providers/filesystem-provider.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/providers/filesystem-provider.ts tests/evolution/observation/providers/filesystem-provider.test.ts
git commit -m "feat(A5): add filesystem observation provider

Filesystem Provider checks file existence, SHA-256 hashes, and stat
metadata. Supports verification against expected values and reality
capture modes. Never mutates the filesystem.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Git Provider

**Files:**
- Create: `src/evolution/observation/providers/git-provider.ts`
- Test: `tests/evolution/observation/providers/git-provider.test.ts`

**Interfaces:**
- Consumes: `Observation`, `ObservationResult`, `ObservationProvider` from Task 1
- Produces: `GitObservationProvider` implementing `ObservationProvider`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { GitObservationProvider } from "../../../../src/evolution/observation/providers/git-provider.js";

function gitInit(dir: string, branch = "main") {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string) {
  writeFileSync(join(dir, "file.txt"), msg);
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "pipe" });
}

describe("GitObservationProvider", () => {
  const provider = new GitObservationProvider();
  let repoDir: string;

  before(() => {
    repoDir = mkdtempSync(join(tmpdir(), "a5-git-test-"));
    gitInit(repoDir);
    gitCommit(repoDir, "Initial commit");
    gitCommit(repoDir, "Second commit");
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("has name 'git'", () => {
    assert.equal(provider.name, "git");
  });

  it("checks git branch", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "git",
      description: "Current branch",
      params: { check: "branch", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, "main");
  });

  it("detects branch mismatch", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "git",
      description: "Branch check",
      expected: "main",
      params: { check: "branch", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, "main");
  });

  it("checks git diff stat", async () => {
    writeFileSync(join(repoDir, "modified.txt"), "change");
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "git",
      description: "Uncommitted changes",
      params: { check: "diff", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.evidence.filesChanged, "number");
    // Clean up
    execSync("git checkout -- .", { cwd: repoDir, stdio: "pipe" });
  });

  it("checks clean repository status", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "git",
      description: "Clean status",
      params: { check: "clean", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
  });

  it("lists files in repository", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "git",
      description: "File list",
      params: { check: "files", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.ok(Array.isArray(result.evidence.files));
    assert.ok(result.evidence.files.length > 0);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "git",
      description: "Invalid",
      params: { check: "invalid", cwd: repoDir },
    });
    assert.equal(result.status, "error");
  });

  it("returns error outside git repository", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "a5-nongit-"));
    try {
      const result = await provider.observe({
        observationId: "obs-7",
        provider: "git",
        description: "No repo",
        params: { check: "branch", cwd: nonGitDir },
      });
      assert.equal(result.status, "error");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/providers/git-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the Git provider**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Git Observation Provider.
 *
 * Observes repository state: branch name, diff stats, file listing,
 * and clean status. Never mutates the repository.
 *
 * @module git-provider
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// GitObservationProvider
// ---------------------------------------------------------------------------

export class GitObservationProvider implements ObservationProvider {
  readonly name = "git";
  readonly capabilities = ["git"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const check = (params?.check as string) ?? "branch";
    const cwd = (params?.cwd as string) ?? process.cwd();

    try {
      switch (check) {
        case "branch": {
          const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 10_000 });
          const branch = stdout.trim();
          return this.buildResult(observation, branch, { check, branch });
        }

        case "diff": {
          const { stdout } = await execFileAsync("git", ["diff", "--stat"], { cwd, timeout: 10_000 });
          const filesChanged = stdout.trim() ? stdout.trim().split("\n").length : 0;
          return this.buildResult(observation, filesChanged, { check, filesChanged, diff: stdout.trim() });
        }

        case "files": {
          const { stdout } = await execFileAsync("git", ["ls-files"], { cwd, timeout: 10_000 });
          const files = stdout.trim().split("\n").filter(Boolean);
          return this.buildResult(observation, files.length, { check, files });
        }

        case "clean": {
          const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000 });
          const isClean = stdout.trim().length === 0;
          return this.buildResult(observation, isClean, { check, isClean, porcelain: stdout.trim() });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}` },
          };
      }
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: nodeErr.code === "ENOENT" ? "environment_failure" : "provider_exception",
          message: (err as Error).message ?? String(err),
          code: nodeErr.code,
        },
      };
    }
  }

  private buildResult(
    observation: Observation,
    observed: unknown,
    evidence: Record<string, unknown>,
  ): ObservationResult {
    const expected = observation.expected;
    let status: "pass" | "fail" | "error" | "inconclusive";

    if (expected !== undefined) {
      status = observed === expected ? "pass" : "fail";
    } else {
      status = "pass";
    }

    return {
      observationId: observation.observationId,
      status,
      confidence: 1.0,
      observedAt: new Date().toISOString(),
      expected,
      observed,
      evidence,
    };
  }
}
```

- [ ] **Step 4: Write the Git provider** (use code from Step 3)

- [ ] **Step 5: Run tests**

```bash
npx tsx --test tests/evolution/observation/providers/git-provider.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/providers/git-provider.ts tests/evolution/observation/providers/git-provider.test.ts
git commit -m "feat(A5): add git observation provider

Git Provider observes branch, diff stats, file listing, and clean
status. Never mutates the repository. Supports verification and
reality capture modes.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Ledger Provider

**Files:**
- Create: `src/evolution/observation/providers/ledger-provider.ts`
- Test: `tests/evolution/observation/providers/ledger-provider.test.ts`

**Interfaces:**
- Consumes: `Observation`, `ObservationResult`, `ObservationProvider` from Task 1
- Consumes: `ExecutionEvidenceStore` (the A2 evidence store, or a `findEvidence` callback)
- Produces: `LedgerObservationProvider` implementing `ObservationProvider`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LedgerObservationProvider } from "../../../../src/evolution/observation/providers/ledger-provider.js";
import { ExecutionEvidenceStore } from "../../../src/evolution/verification/evidence/evidence-store.js";

describe("LedgerObservationProvider", () => {
  let evidenceDir: string;
  let store: ExecutionEvidenceStore;
  let provider: LedgerObservationProvider;

  before(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-ledger-test-"));
    store = new ExecutionEvidenceStore(evidenceDir);
    provider = new LedgerObservationProvider(store);
  });

  after(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("has name 'ledger'", () => {
    assert.equal(provider.name, "ledger");
  });

  it("observes evidence record count", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "ledger",
      description: "Evidence count",
      params: { check: "evidence_count" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "number");
  });

  it("checks for evidence by proposal", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "ledger",
      description: "Has evidence",
      params: { check: "has_evidence", proposalId: "nonexistent" },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, false);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "ledger",
      description: "Invalid",
      params: { check: "invalid" },
    });
    assert.equal(result.status, "error");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/providers/ledger-provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the Ledger provider**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Ledger Observation Provider.
 *
 * Observes governance evidence ledger state. Checks for evidence
 * records, counts, and proposal-specific entries. Never mutates
 * the ledger.
 *
 * @module ledger-provider
 */

import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";
import type { ExecutionEvidenceStore } from "../../verification/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// LedgerObservationProvider
// ---------------------------------------------------------------------------

export class LedgerObservationProvider implements ObservationProvider {
  readonly name = "ledger";
  readonly capabilities = ["ledger"];

  constructor(private readonly evidenceStore: ExecutionEvidenceStore) {}

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const check = (params?.check as string) ?? "evidence_count";

    try {
      switch (check) {
        case "evidence_count": {
          const all = await this.evidenceStore.listAll();
          const count = all.length;
          return this.buildResult(observation, count, { check, count });
        }

        case "has_evidence": {
          const proposalId = params?.proposalId as string | undefined;
          if (!proposalId) {
            return {
              observationId: observation.observationId,
              status: "error",
              confidence: 0,
              observedAt: new Date().toISOString(),
              evidence: { errorType: "environment_failure", message: "proposalId parameter required for has_evidence check" },
            };
          }
          const all = await this.evidenceStore.listAll();
          // Filter by proposalId — the store's evidence records have a proposalId field
          const matching = all.filter((e: Record<string, unknown>) => e.proposalId === proposalId);
          const hasEvidence = matching.length > 0;
          return this.buildResult(observation, hasEvidence, { check, proposalId, count: matching.length });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}` },
          };
      }
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "provider_exception",
          message: (err as Error).message ?? String(err),
        },
      };
    }
  }

  private buildResult(
    observation: Observation,
    observed: unknown,
    evidence: Record<string, unknown>,
  ): ObservationResult {
    const expected = observation.expected;
    let status: "pass" | "fail" | "error" | "inconclusive";

    if (expected !== undefined) {
      status = observed === expected ? "pass" : "fail";
    } else {
      status = "pass";
    }

    return {
      observationId: observation.observationId,
      status,
      confidence: 1.0,
      observedAt: new Date().toISOString(),
      expected,
      observed,
      evidence,
    };
  }
}
```

- [ ] **Step 4: Write the Ledger provider** (use code from Step 3)

- [ ] **Step 5: Run tests**

```bash
npx tsx --test tests/evolution/observation/providers/ledger-provider.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/providers/ledger-provider.ts tests/evolution/observation/providers/ledger-provider.test.ts
git commit -m "feat(A5): add ledger observation provider

Ledger Provider observes the governance evidence store: record counts
and evidence presence by proposal. Never mutates the ledger.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Evidence Bridge

**Files:**
- Create: `src/evolution/observation/observation-evidence-bridge.ts`
- Test: `tests/evolution/observation/observation-evidence-bridge.test.ts`

**Interfaces:**
- Consumes: `ObservationResult` from Task 1, `VerificationEvidence` from A2
- Produces: `buildObservationEvidence()` → `VerificationEvidence`
- Produces: `ObservationBuildInput`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildObservationEvidence } from "../../../src/evolution/observation/observation-evidence-bridge.js";
import type { ObservationResult } from "../../../src/evolution/observation/contracts/observation-contract.js";

const BASE_TIME = "2026-07-12T00:00:00.000Z";

function makeResult(overrides?: Partial<ObservationResult>): ObservationResult {
  return {
    observationId: "obs-1",
    status: "pass",
    confidence: 1.0,
    observedAt: BASE_TIME,
    evidence: { cmd: "test" },
    ...overrides,
  };
}

describe("buildObservationEvidence", () => {
  it("produces evidence with observed class", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult()],
    });

    assert.equal(evidence.evidenceClass, "observed");
    assert.equal(evidence.proposalId, "prop-001");
  });

  it("computes aggregate metrics from observations", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "o1", status: "pass", confidence: 1.0 }),
        makeResult({ observationId: "o2", status: "fail", confidence: 0.9 }),
        makeResult({ observationId: "o3", status: "error", confidence: 0 }),
      ],
    });

    // baselineMetrics should contain aggregate pass/fail counts
    assert.equal(typeof evidence.baselineMetrics.passCount, "number");
    assert.equal(evidence.baselineMetrics.passCount, 1);
    assert.equal(evidence.baselineMetrics.failCount, 1);
    assert.equal(evidence.baselineMetrics.errorCount, 1);
    assert.equal(typeof evidence.baselineMetrics.meanConfidence, "number");
  });

  it("populates behavioralChanges from observation descriptions", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "o1", status: "pass", description: "CLI exited with code 0" }),
        makeResult({ observationId: "o2", status: "fail", description: "File not found", expected: true, observed: false }),
      ],
    });

    assert.ok(evidence.behavioralChanges.length > 0);
    // Behavioral changes should be faithful projections, not interpretations
    const hasFaithfulProjection = evidence.behavioralChanges.some(
      (c) => c.includes("CLI exited with code 0") || c.includes("File not found"),
    );
    assert.ok(hasFaithfulProjection);
  });

  it("computes integrity hash", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult()],
    });

    assert.equal(typeof evidence.integrityHash, "string");
    assert.ok(evidence.integrityHash.length > 0);
  });

  it("preserves lineage from observations to evidence", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "obs-1" }),
        makeResult({ observationId: "obs-2" }),
      ],
    });

    assert.ok(evidence.lineage.length > 0);
    const obsLineage = evidence.lineage.find((l) => l.step === "observation");
    assert.ok(obsLineage);
  });

  it("deterministic: same inputs produce same outputs", () => {
    const input = {
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult({ observationId: "o1", status: "pass" })],
    };

    const a = buildObservationEvidence(input);
    const b = buildObservationEvidence(input);

    assert.equal(a.evidenceId, b.evidenceId);
    assert.equal(a.integrityHash, b.integrityHash);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/observation-evidence-bridge.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the evidence bridge**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Evidence Bridge.
 *
 * Aggregates ObservationResult[] into VerificationEvidence with
 * evidenceClass: "observed". Faithfully projects observation outcomes
 * into behavioralChanges — does not infer governance conclusions.
 *
 * @module observation-evidence-bridge
 */

import { createHash, randomUUID } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import type { ObservationResult } from "./contracts/observation-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_INTEGRITY_PREFIX = "alix-evolution-observed-v1:";
const DEFAULT_EVIDENCE_TTL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// ObservationBuildInput
// ---------------------------------------------------------------------------

export interface ObservationBuildInput {
  /** The evolution proposal ID. */
  readonly proposalId: string;
  /** The evolution ID. */
  readonly evolutionId: string;
  /** Snapshot hash of the environment at observation time. */
  readonly environmentHash: string;
  /** Observation results to aggregate into evidence. */
  readonly observations: readonly ObservationResult[];
}

// ---------------------------------------------------------------------------
// buildObservationEvidence
// ---------------------------------------------------------------------------

export function buildObservationEvidence(input: ObservationBuildInput): VerificationEvidence {
  const { proposalId, evolutionId, environmentHash, observations } = input;

  // Aggregate metrics
  const passCount = observations.filter((o) => o.status === "pass").length;
  const failCount = observations.filter((o) => o.status === "fail").length;
  const errorCount = observations.filter((o) => o.status === "error").length;
  const inconclusiveCount = observations.filter((o) => o.status === "inconclusive").length;
  const totalCount = observations.length;

  const confidences = observations.map((o) => o.confidence);
  const meanConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  // Faithful behavioral change projections (NOT governance interpretations)
  const behavioralChanges: string[] = [];
  for (const obs of observations) {
    if (obs.status === "pass") {
      behavioralChanges.push(`Observation "${obs.observationId}" passed: ${obs.description}`);
    } else if (obs.status === "fail") {
      const expected = obs.expected !== undefined ? ` (expected: ${JSON.stringify(obs.expected)}, observed: ${JSON.stringify(obs.observed)})` : "";
      behavioralChanges.push(`Observation "${obs.observationId}" FAILED: ${obs.description}${expected}`);
    } else if (obs.status === "error") {
      behavioralChanges.push(`Observation "${obs.observationId}" ERROR: ${obs.description}`);
    } else {
      behavioralChanges.push(`Observation "${obs.observationId}" inconclusive: ${obs.description}`);
    }
  }

  // Build lineage
  const lineage = [
    {
      step: "observation",
      sourceId: input.evolutionId,
      sourceType: "evaluation" as const,
      timestamp: new Date().toISOString(),
    },
    ...observations.map((o) => ({
      step: "observation_result" as const,
      sourceId: o.observationId,
      sourceType: "evaluation" as const,
      timestamp: o.observedAt,
    })),
  ];

  // Build evidence without integrity hash
  const evidenceId = `obs-ev-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DEFAULT_EVIDENCE_TTL_DAYS * MS_PER_DAY).toISOString();

  const evidence = {
    evidenceId,
    verificationId: `obs-${input.evolutionId}`,
    proposalId,
    replayDatasetId: "",
    evidenceClass: "observed" as const,
    proposalSnapshotHash: "",
    environmentHash,
    baselineMetrics: {
      totalCount,
      passCount,
      failCount,
      errorCount,
      inconclusiveCount,
      meanConfidence,
    } as Record<string, number>,
    candidateMetrics: {} as Record<string, number>,
    metricDeltas: {
      passRate: totalCount > 0 ? passCount / totalCount : 0,
      failRate: totalCount > 0 ? failCount / totalCount : 0,
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
    } as Record<string, number>,
    behavioralChanges,
    confidenceProfile: {
      overallConfidence: meanConfidence,
      minConfidence: confidences.length > 0 ? Math.min(...confidences) : 0,
      maxConfidence: confidences.length > 0 ? Math.max(...confidences) : 0,
      decayFactor: 0,
      confidenceSources: ["observation"] as readonly string[],
      contributorCount: observations.length,
    },
    reproducibilityLevel: 0 as const,
    lineage,
    verifiedAt: now,
    expiresAt,
    reverificationRequired: false,
    integrityHash: "",
  };

  // Compute integrity hash
  const { integrityHash: _h, ...withoutHash } = evidence;
  void _h;
  const clean = Object.fromEntries(
    Object.entries(withoutHash).filter(([_, v]) => v !== undefined),
  );
  const payload = canonicalStringify(clean);
  const hash = createHash("sha256");
  hash.update(EVIDENCE_INTEGRITY_PREFIX);
  hash.update(payload, "utf8");
  evidence.integrityHash = hash.digest("hex");

  return evidence as VerificationEvidence;
}
```

- [ ] **Step 4: Write the bridge** (use code from Step 3)

- [ ] **Step 5: Run tests**

```bash
npx tsx --test tests/evolution/observation/observation-evidence-bridge.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/evolution/observation/observation-evidence-bridge.ts tests/evolution/observation/observation-evidence-bridge.test.ts
git commit -m "feat(A5): add observation evidence bridge

Aggregates ObservationResult[] into VerificationEvidence with
evidenceClass 'observed'. Faithfully projects observation outcomes
into behavioralChanges — does not infer governance conclusions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: CLI Handler

**Files:**
- Create: `src/evolution/observation/observation-cli.ts`
- Modify: `src/governance/evolution-cli.ts` (add `observe` case + help + import)
- Test: `tests/evolution/observation/observation-cli.test.ts`

**Interfaces:**
- Consumes: `ObservationEngine` from Task 2, `buildObservationEvidence` from Task 7
- Consumes: `EvolutionCLIDeps` from `evolution-cli.ts`
- Produces: `runObserve()` CLI handler

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runObserve } from "../../../src/evolution/observation/observation-cli.js";
import { ObservationEngine } from "../../../src/evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../../../src/evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../../../src/evolution/observation/providers/filesystem-provider.js";
import { ExecutionEvidenceStore } from "../../../src/evolution/verification/evidence/evidence-store.js";
import { EvolutionStateMachine } from "../../../src/evolution/evolution-state-machine.js";

describe("runObserve", () => {
  let engine: ObservationEngine;
  let evidenceDir: string;
  let evidenceStore: ExecutionEvidenceStore;
  let stateMachine: EvolutionStateMachine;

  before(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-cli-test-"));
    evidenceStore = new ExecutionEvidenceStore(evidenceDir);
    stateMachine = new EvolutionStateMachine();

    engine = new ObservationEngine();
    engine.register(new CliObservationProvider());
    engine.register(new FilesystemObservationProvider());
  });

  after(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("observes and produces evidence", async () => {
    // Use a simple command that definitely exists
    const result = await runObserve("evol-test-001", {
      engine,
      evidenceStore,
    });

    assert.equal(typeof result.evidenceId, "string");
    assert.equal(result.evidenceClass, "observed");
    assert.equal(result.proposalId, "evol-test-001");
  });

  it("stores evidence in ledger", async () => {
    const result = await runObserve("evol-test-002", {
      engine,
      evidenceStore,
    });

    const stored = await evidenceStore.get(result.evidenceId);
    assert.ok(stored);
    assert.equal(stored.evidenceId, result.evidenceId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx --test tests/evolution/observation/observation-cli.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the CLI handler**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation CLI Handler.
 *
 * CLI handler for `alix evolution observe <evolution-id>` command.
 * Dispatches observations via ObservationEngine, builds evidence,
 * stores in ledger.
 *
 * @module observation-cli
 */

import type { ObservationEngine } from "./observation-engine.js";
import { buildObservationEvidence, type ObservationBuildInput } from "./observation-evidence-bridge.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import type { ExecutionEvidenceStore } from "../verification/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// ObserveDeps
// ---------------------------------------------------------------------------

export interface ObserveDeps {
  /** The observation engine (with providers already registered). */
  engine: ObservationEngine;
  /** Evidence store for persisting observed evidence. */
  evidenceStore: ExecutionEvidenceStore;
}

// ---------------------------------------------------------------------------
// ObservedFlags
// ---------------------------------------------------------------------------

export interface ObserveFlags {
  jsonMode: boolean;
  reevaluate: boolean;
}

// ---------------------------------------------------------------------------
// runObserve
// ---------------------------------------------------------------------------

/**
 * Run observations for an evolution and produce VerificationEvidence.
 *
 * @param evolutionId - The evolution to observe.
 * @param deps - Dependencies (engine, evidenceStore).
 * @param flags - Optional flags (jsonMode, reevaluate).
 * @returns The produced VerificationEvidence.
 */
export async function runObserve(
  evolutionId: string,
  deps: ObserveDeps,
  flags?: Partial<ObserveFlags>,
): Promise<VerificationEvidence> {
  const { engine, evidenceStore } = deps;
  const jsonMode = flags?.jsonMode ?? false;

  // Build v1 observation set — one per registered provider
  const observations = buildObservationSet(evolutionId);

  // Dispatch to engine
  const results = await engine.observeAll(observations);

  // Build evidence
  const evidence = buildObservationEvidence({
    proposalId: evolutionId,
    evolutionId,
    environmentHash: "observation-v1",
    observations: results,
  });

  // Store evidence in ledger
  await evidenceStore.set(evidence.evidenceId, evidence);

  // Output
  if (jsonMode) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    renderObservationResult(evidence);
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the default observation set for an evolution.
 * V1: one Observation per registered provider name.
 */
function buildObservationSet(evolutionId: string) {
  return [
    {
      observationId: `cli-status-${evolutionId}`,
      provider: "cli",
      description: "ALiX status command",
      params: { command: "alix", args: ["status"] },
    },
    {
      observationId: `fs-evolution-${evolutionId}`,
      provider: "filesystem",
      description: "Evidence directory exists",
      params: { path: process.cwd(), check: "exists" },
    },
    {
      observationId: `git-branch-${evolutionId}`,
      provider: "git",
      description: "Git branch state",
      params: { check: "branch" },
    },
    {
      observationId: `ledger-count-${evolutionId}`,
      provider: "ledger",
      description: "Evidence record count",
      params: { check: "evidence_count" },
    },
  ];
}

function renderObservationResult(evidence: VerificationEvidence): void {
  console.log(`\n  A5 Observation Results for ${evidence.proposalId}`);
  console.log(`  ${"=".repeat(50)}`);
  console.log(`  Evidence ID:  ${evidence.evidenceId}`);
  console.log(`  Class:        ${evidence.evidenceClass}`);
  console.log(`  Confidence:   ${(evidence.confidenceProfile.overallConfidence * 100).toFixed(1)}%`);
  console.log(`  Observations: ${evidence.baselineMetrics.totalCount ?? "N/A"}`);
  console.log(`  Passed:       ${evidence.baselineMetrics.passCount ?? 0}`);
  console.log(`  Failed:       ${evidence.baselineMetrics.failCount ?? 0}`);
  console.log(`  Errors:       ${evidence.baselineMetrics.errorCount ?? 0}`);
  console.log(`  Inconclusive: ${evidence.baselineMetrics.inconclusiveCount ?? 0}`);
  console.log("");
}
```

- [ ] **Step 4: Write the CLI handler** (use code from Step 3)

- [ ] **Step 5: Modify evolution-cli.ts to add observe case**

Add to the import block:

```typescript
import { runObserve } from "../evolution/observation/observation-cli.js";
```

Add before `default:` in the switch:

```typescript
case "observe":
  if (!id) {
    console.log(red("Usage: alix governance evolution observe <evolution-id> [--json] [--reevaluate]"));
    process.exitCode = 1;
    return;
  }
  return runObserve(id, {
    engine: buildObservationEngine(deps),
    evidenceStore: deps.evidenceStore,
  }, { jsonMode, reevaluate: args.includes("--reevaluate") });
```

Add helper function:

```typescript
function buildObservationEngine(deps: EvolutionCLIDeps): ObservationEngine {
  const { ObservationEngine } = require("../evolution/observation/observation-engine.js");
  const { CliObservationProvider } = require("../evolution/observation/providers/cli-provider.js");
  const { FilesystemObservationProvider } = require("../evolution/observation/providers/filesystem-provider.js");
  const { GitObservationProvider } = require("../evolution/observation/providers/git-provider.js");
  const { LedgerObservationProvider } = require("../evolution/observation/providers/ledger-provider.js");

  const engine = new ObservationEngine();
  engine.register(new CliObservationProvider());
  engine.register(new FilesystemObservationProvider());
  engine.register(new GitObservationProvider());
  engine.register(new LedgerObservationProvider(deps.evidenceStore));
  return engine;
}
```

Add to help text:

```typescript
console.log("  observe <id>      Run outcome observations on an executed evolution (A5)");
```

Add import for `ObservationEngine` at the top:

```typescript
import { ObservationEngine } from "../evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../evolution/observation/providers/filesystem-provider.js";
import { GitObservationProvider } from "../evolution/observation/providers/git-provider.js";
import { LedgerObservationProvider } from "../evolution/observation/providers/ledger-provider.js";
```

- [ ] **Step 6: Run CLI tests**

```bash
npx tsx --test tests/evolution/observation/observation-cli.test.ts
```

Expected: ALL tests pass

- [ ] **Step 7: Run full test suite to verify no regressions**

```bash
npx tsx --test tests/governance/evolution-cli.test.ts
npx tsc --noEmit
```

Expected: ALL pass, tsc clean

- [ ] **Step 8: Commit**

```bash
git add src/evolution/observation/observation-cli.ts tests/evolution/observation/observation-cli.test.ts src/governance/evolution-cli.ts
git commit -m "feat(A5): add observation CLI handler

Add alix governance evolution observe command. Dispatches default
observation set to ObservationEngine, builds VerificationEvidence,
stores in ledger. --reevaluate flag for optional governance re-entry.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Integration Test

**Files:**
- Create: `tests/evolution/observation/integration/observation-integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Integration Test.
 *
 * End-to-end test of the A5 observation pipeline:
 * ObservationEngine → Providers → Evidence Bridge → Ledger storage.
 *
 * @module observation-integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { ObservationEngine } from "../../../../src/evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../../../../src/evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../../../../src/evolution/observation/providers/filesystem-provider.js";
import { GitObservationProvider } from "../../../../src/evolution/observation/providers/git-provider.js";
import { LedgerObservationProvider } from "../../../../src/evolution/observation/providers/ledger-provider.js";
import { buildObservationEvidence } from "../../../../src/evolution/observation/observation-evidence-bridge.js";
import { ExecutionEvidenceStore } from "../../../../src/evolution/verification/evidence/evidence-store.js";

function createGitRepo(dir: string) {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "readme.md"), "# test");
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
}

describe("A5 Observation Integration", () => {
  let testDir: string;
  let evidenceDir: string;
  let engine: ObservationEngine;
  let evidenceStore: ExecutionEvidenceStore;
  const originalCwd = process.cwd;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "a5-integration-"));
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-integration-ev-"));
    createGitRepo(testDir);

    evidenceStore = new ExecutionEvidenceStore(evidenceDir);
    engine = new ObservationEngine();

    engine.register(new CliObservationProvider());
    engine.register(new FilesystemObservationProvider());
    engine.register(new GitObservationProvider());
    engine.register(new LedgerObservationProvider(evidenceStore));
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("runs all providers and aggregates evidence", async () => {
    // Run observations using all four providers
    const results = await engine.observeAll([
      {
        observationId: "int-cli",
        provider: "cli",
        description: "Check node version",
        params: { command: "node", args: ["--version"] },
      },
      {
        observationId: "int-fs",
        provider: "filesystem",
        description: "Test directory exists",
        params: { path: testDir, check: "exists" },
      },
      {
        observationId: "int-git",
        provider: "git",
        description: "Check repository branch",
        params: { check: "branch", cwd: testDir },
      },
      {
        observationId: "int-ledger",
        provider: "ledger",
        description: "Check initial evidence count",
        params: { check: "evidence_count" },
      },
    ]);

    // All results should be valid
    assert.equal(results.length, 4);

    // All should succeed (node --version, existing dir, git repo, empty ledger)
    const passes = results.filter((r) => r.status === "pass");
    assert.ok(passes.length >= 3, `Expected ≥3 passes, got ${passes.length}`);
    assert.ok(results.every((r) => r.observationId), "All results should have observationId");
    assert.ok(results.every((r) => r.evidence), "All results should have evidence");

    // Build evidence from results
    const evidence = buildObservationEvidence({
      proposalId: "int-proposal-001",
      evolutionId: "int-evol-001",
      environmentHash: "test-env-hash",
      observations: results,
    });

    // Verify evidence structure
    assert.equal(evidence.evidenceClass, "observed");
    assert.equal(typeof evidence.integrityHash, "string");
    assert.ok(evidence.integrityHash.length > 0);
    assert.equal(evidence.proposalId, "int-proposal-001");

    // Verify behavioral changes are faithful projections
    for (const change of evidence.behavioralChanges) {
      assert.ok(change.startsWith("Observation"), `Should start with 'Observation': ${change}`);
    }

    // Store and retrieve
    await evidenceStore.set(evidence.evidenceId, evidence);
    const stored = await evidenceStore.get(evidence.evidenceId);
    assert.ok(stored);
    assert.equal(stored.evidenceId, evidence.evidenceId);

    // Determinism: same inputs → same evidence
    const evidence2 = buildObservationEvidence({
      proposalId: "int-proposal-001",
      evolutionId: "int-evol-001",
      environmentHash: "test-env-hash",
      observations: results,
    });
    assert.equal(evidence2.evidenceId, evidence.evidenceId);
    assert.equal(evidence2.integrityHash, evidence.integrityHash);
  });

  it("handles provider errors gracefully", async () => {
    const results = await engine.observeAll([
      {
        observationId: "err-cli",
        provider: "cli",
        description: "Nonexistent command",
        params: { command: "this-command-does-not-exist" },
      },
      {
        observationId: "err-provider",
        provider: "nonexistent-provider",
        description: "Unknown provider",
      },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].status, "error");
    assert.equal(results[1].status, "error");
    // Provider errors should not throw
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npx tsx --test tests/evolution/observation/integration/observation-integration.test.ts
```

Expected: ALL tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/evolution/observation/integration/observation-integration.test.ts
git commit -m "test(A5): add end-to-end observation integration test

Covers all four providers in a real scenario with git repo, filesystem,
CLI commands, and ledger storage. Verifies evidence structure,
deterministic hashing, and graceful error handling.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Barrel Exports

**Files:**
- Create: `src/evolution/observation/index.ts`

- [ ] **Step 1: Write the barrel exports**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5 — Observation module barrel exports.
 *
 * @module observation
 */

export * from "./contracts/observation-contract.js";
export * from "./observation-engine.js";
export * from "./observation-evidence-bridge.js";
export * from "./observation-cli.js";
```

- [ ] **Step 2: Verify tsc still clean**

```bash
npx tsc --noEmit
```

Expected: clean

- [ ] **Step 3: Run full A5 test suite**

```bash
npx tsx --test tests/evolution/observation/**/*.test.ts tests/evolution/observation/**/**/*.test.ts
```

Expected: ALL tests pass

- [ ] **Step 4: Commit**

```bash
git add src/evolution/observation/index.ts
git commit -m "feat(A5): add barrel exports

Export all A5 public interfaces from index.ts.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec coverage
- [x] Core contracts (Observation, ObservationResult, ObservationProvider) — Task 1
- [x] Deterministic provider routing by name — Task 2
- [x] Engine with registration, dispatch, observeAll — Task 2
- [x] Result ordering preserved for deterministic hashing — Task 2
- [x] Provider never-throw invariant — Tasks 2-6 (engine wraps, providers catch)
- [x] CLI Provider — Task 3
- [x] Filesystem Provider — Task 4
- [x] Git Provider — Task 5
- [x] Ledger Provider — Task 6
- [x] Evidence bridge with faithful projections — Task 7
- [x] CLI handler with --reevaluate — Task 8
- [x] evolution-cli.ts wiring — Task 8
- [x] Integration test — Task 9
- [x] Barrel exports — Task 10

### Placeholder scan
- [x] No "TBD", "TODO", or placeholder comments in task code
- [x] No "add appropriate error handling" — all error handling is explicit
- [x] No "write tests for the above" — all test code is shown inline
- [x] No "similar to Task N" — every task has complete code
- [x] No undefined references — all types are defined by prior tasks

### Type consistency
- [x] `Observation.provider` → `ObservationEngine.register()` — string routing in both
- [x] `ObservationResult.status` → `ObservationStatus` union — 4 values consistent
- [x] `buildObservationEvidence()` → `VerificationEvidence` — matches A2 contract
- [x] `runObserve()` → `ObserveDeps` — matches CLI handler signature
