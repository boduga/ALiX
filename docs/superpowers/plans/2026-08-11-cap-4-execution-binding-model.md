# CAP-4 — Execution Binding Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider bindings + ordered fallback + explicit availability replace strategy-keyed dispatch: a capability's `bindings[]` resolve through a type-keyed provider registry, execute through provider executors, fail over on fallback-eligible errors within one bounded pass, and never change capability identity.

**Architecture:** New `ProviderExecutorRegistry` (type → `ProviderExecutor`, duplicate-rejecting) + `ProviderResolver` (composition steps carrying ordered, eligibility-filtered `candidates`) replace `ExecutorRegistry` + `ExecutionResolver`. `CapabilityRuntime` walks each step's candidates with the R1 error-class gate (`isFallbackEligibleKind`); exhaustion writes `CapabilityAvailability{available:false, reason}` on the registry — an availability change, never a lifecycle change. Legacy `NativeExecutor`/`ToolExecutorAdapter` stay (forbidden files + shared callers import them); new provider executors wrap them. Legacy dispatch surfaces (`ExecutionResolver`, `ExecutorRegistry`, `CapabilityExecutor`, `ToolExecutorAdapter`, `createToolExecutorAdapter`) are removed in the final task.

**Tech Stack:** TypeScript (ESM, `node:child_process` for external-cli), Vitest (`.vitest.ts`, esbuild — NO typecheck; `pnpm exec tsc --noEmit` is the type gate), the existing `CapabilityCatalog`/`CapabilityRegistry` from CAP-2/CAP-3.

## Global Constraints

- **Provider vocabulary is ADR-0013 §4 verbatim:** `ProviderType = "native" | "tool" | "mcp" | "external-cli" | "daemon" | "agent" | "plugin" | "remote-api"` (already in `src/capability/canonical/provider.ts` — do not redefine).
- **Provider technologies are NOT kinds (#475).** `CapabilityKind` untouched.
- **Provider registry is type-keyed and duplicate-rejecting** (user ruling): `Map<ProviderType, ProviderExecutor>`; `register` throws on a duplicate type — deterministic wiring. Instance identity lives in `binding.id`/`binding.config`, never in the registry key.
- **`allowFallbacks` is a first-class `CapabilityDefinition` field** (user ruling): `allowFallbacks?: boolean`, default `true`. Semantics (user ruling): when `false`, the resolver pins to `bindings[0]` only — it may reject `bindings[0]` during resolution if ineligible (unavailable/disabled/unhealthy), but MUST NOT proceed to `bindings[1]`. Pin ≠ blindly invoke.
- **`CapabilityAvailability` collapses to `{ available: boolean; reason?: "missing_binding" | "provider_unavailable" }`** (user ruling): rename `enabled` → `available`, drop `binding_unavailable` and the other CAP-3 reasons. `missing_binding` = nothing to resolve; `provider_unavailable` = something to resolve but no provider usable. Fallback exhaustion is NOT a separate reason — it is `provider_unavailable`.
- **Exhaustion → availability, never lifecycle** (#481, #476): a provider outage / fallback exhaustion sets `{available:false, reason:"provider_unavailable"}` on the registry and leaves `lifecycle` untouched. `active + unavailable` is legal.
- **Fallback never changes capability identity** (#476): `code.repository.impact` stays `code.repository.impact` across GitNexus/MCP/native. Provider selection is a runtime concern (ADR-0013 §5).
- **Existing `CircuitBreaker`/`checkProvider` remain the health mechanism** (program CAP-4): the resolver consumes an injectable `isProviderHealthy` probe; wiring real CircuitBreaker instances into the probe is a follow-up (CAP-7/8), not this CAP.
- **MCP rule (ADR-0013):** MCP protocol plumbing is NOT registered as capabilities; MCP resources stay provider resources unless a meaningful semantic operation. `capability-mapper.ts` is unchanged by CAP-4.
- **Forbidden files (never touch):** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`. `src/capability/canonical/*` is CAP-owned: CAP-4 owns ONLY the `allowFallbacks` field + its validation in `canonical/definition.ts` (user ruling #1 requires it) — do not restructure canonical files otherwise.
- **`CapabilityExecution` / `Capability` (legacy `types.ts`) shape is unchanged.** `NativeExecutor` keeps its dependency-free constructor and `run(capability, ctx, args)` signature (forbidden `initial-capabilities.ts` and `session-capabilities.ts` import it by name).
- **Capability tests are `.vitest.ts`; ALWAYS run `pnpm exec tsc --noEmit` after each task** (Vitest does not typecheck — CAP-1 lesson).

### R1 Error Taxonomy (contract — closed, testable, established BEFORE Task 5)

`ProviderErrorKind` is the closed classification (Task 2 encodes it as the pure `classifyErrorKind(result): ProviderErrorKind` function; every executor and the runtime call it — no scattered `instanceof`/status-code logic). The gate is `isFallbackEligibleKind(kind)`.

| Kind | Means | Fallback |
|---|---|---|
| `unavailable` | provider down / ENOENT / transport disconnected | ✅ eligible |
| `timeout` | provider timed out | ✅ eligible |
| `rate-limit` | provider 429 | ✅ eligible |
| `http-5xx` | provider 5xx | ✅ eligible |
| `bad-request` | malformed request / invalid args | ❌ fatal |
| `auth` | permission/credential failure | ❌ fatal |
| `contract` | provider returned an unexpected shape | ❌ fatal |
| `configuration` | binding misconfigured (missing `executable`) | ❌ fatal |
| `fatal` | deterministic capability rejection / unclassified | ❌ fatal |

**Classification contract (the acceptance proof):**
- **Provider failure → fallback permitted** — unavailable, timeout, rate-limit, http-5xx.
- **Capability failure → NO fallback** — invalid args, permission denied by capability policy, malformed request, deterministic rejection. These STOP the walk.
- **Fatal/system failure → NO fallback** — auth, contract, configuration.
- `undefined` errorKind → `fatal` (fail-closed).

### Resolution ≠ Execution (the core boundary)

Three phases, never conflated:
1. **Resolution** (resolver, pre-execution) — what *can* be attempted: binding exists → provider type recognized → executor registered → health probe. Produces `ProviderCandidate[]`.
2. **Execution** (runtime) — what *happened*: `candidate.executor.run(candidate, request)`. Produces `ProviderRunResult`.
3. **R1 gate** (runtime, post-execution) — whether what happened permits another attempt: `isFallbackEligibleKind(runResult.errorKind)`.

A provider can be **eligible and then fail during execution** (gh eligible → ENOENT/timeout/503 → provider failure → fallback to MCP). Execution failure goes through the **R1 gate**, never back through availability resolution. The resolver decides what can be attempted; the runtime decides what happened and whether to try again.

### No CAP-4 provider executor may depend on legacy strategy machinery

**Hard invariant:** `NativeProviderExecutor`, `ToolProviderExecutor`, `McpProviderExecutor`, `ExternalCliProviderExecutor`, `UnavailableProviderExecutor` MUST NOT import or depend on `ExecutorRegistry` or `ExecutionResolver`. Task 5 must leave **every runtime path provider-bound** (native/tool/mcp/external-cli all route through their `*ProviderExecutor`). Task 6 is then genuine deletion of dead code, not migration-by-deletion. `NativeExecutor` itself is kept (forbidden callers import it) and is *wrapped* by `NativeProviderExecutor`, never routed through a registry.

### Candidate metadata carries provider identity (first-class execution fact)

Every attempt is immutable candidate metadata + the constant capability identity. `ProviderCandidate` (Task 2) is:

```ts
interface ProviderCandidate {
  binding: CapabilityProviderBinding;      // { id: "gitnexus", type: "external-cli", config }
  providerId: string;                       // = binding.id
  providerType: ProviderType;               // = binding.type
  bindingIndex: number;                     // position in bindings[]
  executor: ProviderExecutor;
}
```

The runtime's result/event contract surfaces which provider served (and which failed): the `InvocationResult` carries `servingProvider?: { providerId, providerType, bindingIndex }`. `code.repository.impact` stays the capabilityId across `gitnexus → github → native`; the *provider* identity changes. Enforced by the result/event contract, not merely asserted in one integration test.

---

### Task 1: Canonical model — `allowFallbacks` field + availability contract

**Files:**
- Modify: `src/capability/canonical/definition.ts` (add `allowFallbacks?: boolean` + validation)
- Modify: `src/capability/registry.ts` (`CapabilityAvailability` collapse, `setAvailability`, refresh default)
- Test: `tests/capability/canonical/definition.vitest.ts` (append allowFallbacks cases)
- Test: `tests/capability/registry-projection.vitest.ts` (update `enabled` → `available`; add availability tests)

**Interfaces:**
- Consumes: `CapabilityDefinition` (existing), `CapabilityRegistry.get/ensureEntry` (existing), `CapabilityAvailability` (existing CAP-3 shape being replaced).
- Produces: `CapabilityDefinition.allowFallbacks?: boolean` (default `true` when omitted); `CapabilityAvailability { available: boolean; reason?: "missing_binding" | "provider_unavailable" }`; `registry.setAvailability(id: string, availability: CapabilityAvailability): void`. Task 5 consumes `setAvailability` on fallback exhaustion.

- [ ] **Step 1: Append allowFallbacks validation cases to `tests/capability/canonical/definition.vitest.ts`**

Add inside the `describe("CapabilityDefinition", ...)` block, after the existing "rejects non-serializable extensions" test (the file already has a `makeDef(over)` helper — reuse it):

```ts
  it("accepts allowFallbacks: true", () => {
    expect(() => validateCapabilityDefinition(makeDef({ allowFallbacks: true }))).not.toThrow();
  });

  it("accepts allowFallbacks omitted (defaults to true)", () => {
    expect(() => validateCapabilityDefinition(makeDef())).not.toThrow();
  });

  it("rejects a non-boolean allowFallbacks", () => {
    expect(() => validateCapabilityDefinition({ ...makeDef(), allowFallbacks: "yes" } as unknown)).toThrow(/allowFallbacks/);
  });
```

- [ ] **Step 2: Run the canonical definition tests to verify they fail**

Run: `pnpm exec vitest run tests/capability/canonical/definition.vitest.ts`
Expected: FAIL — the three new tests fail (validateCapabilityDefinition does not yet check `allowFallbacks`; non-boolean passes).

- [ ] **Step 3: Add `allowFallbacks` to `CapabilityDefinition` + validation**

In `src/capability/canonical/definition.ts`, add the field to the interface (after `bindings`, before `extensions`):

```ts
  /** R1 fallback policy (#476). Omitted/true = try bindings in declared order
   *  until one succeeds or the chain is exhausted; false = only bindings[0]
   *  may execute (still eligibility-filtered — never a blind invoke). */
  allowFallbacks?: boolean;
```

Add to `validateCapabilityDefinition`, after the bindings loop:

```ts
  if (d.allowFallbacks !== undefined && typeof d.allowFallbacks !== "boolean") {
    throw new Error("capability: definition allowFallbacks must be a boolean");
  }
```

- [ ] **Step 4: Collapse `CapabilityAvailability` in `src/capability/registry.ts`**

Replace the interface:

```ts
/** CAP-4 canonical availability (user ruling): two unavailable reasons.
 *  missing_binding = nothing to resolve; provider_unavailable = something to
 *  resolve but no provider is currently usable. Exhaustion is provider_unavailable,
 *  never a separate reason. Availability is NOT a lifecycle change. */
export interface CapabilityAvailability {
  available: boolean;
  reason?: "missing_binding" | "provider_unavailable";
}
```

Update the `refresh()` default (line ~93):

```ts
        availability: prev?.availability ?? { available: true },
```

Add `setAvailability` after `getAvailability`:

```ts
  /** Runtime exhaustion feedback (CAP-4): marks a capability provider-unavailable
   *  or missing-binding WITHOUT touching lifecycle (#476, #481). */
  setAvailability(id: string, availability: CapabilityAvailability): void {
    const entry = this.ensureEntry(id);
    entry.availability = availability;
  }
```

- [ ] **Step 5: Update `tests/capability/registry-projection.vitest.ts`**

Change line ~47 `expect(rc?.availability.enabled).toBe(true);` → `expect(rc?.availability.available).toBe(true);`. Append a new test block after the existing "canonical get() ..." test:

```ts
  it("setAvailability writes provider_unavailable and leaves lifecycle unchanged", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    registry.setAvailability("tool.file.read", { available: false, reason: "provider_unavailable" });
    expect(registry.getAvailability("tool.file.read")).toEqual({ available: false, reason: "provider_unavailable" });
    expect(registry.getLifecycleState("tool.file.read")).toBe("emerging");  // availability ≠ lifecycle
  });
```

- [ ] **Step 6: Run the two test files**

Run: `pnpm exec vitest run tests/capability/canonical/definition.vitest.ts tests/capability/registry-projection.vitest.ts`
Expected: PASS (all old + new cases).

- [ ] **Step 7: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0 (no other file referenced the old 7-reason union or `.availability.enabled`).

- [ ] **Step 8: Commit**

```bash
git add src/capability/canonical/definition.ts src/capability/registry.ts tests/capability/canonical/definition.vitest.ts tests/capability/registry-projection.vitest.ts
git commit -m "feat(capability): CAP-4 allowFallbacks field + collapsed availability contract"
```

---

### Task 2: Provider registry + executor seam (pure additions)

**Files:**
- Create: `src/capability/provider-registry.ts`
- Create: `src/capability/provider-executor.ts`
- Test: `tests/capability/provider-registry.vitest.ts`
- Test: `tests/capability/provider-executor.vitest.ts`

**Interfaces:**
- Consumes: `ProviderType` + `CapabilityProviderBinding` (`canonical/provider.ts`); `NativeExecutor` (`executors.ts` — unchanged); `ToolCallRequest`/`ExecuteResult` (`tools/types.ts`, `tools/executor.ts`); `Capability`/`CapabilityContext` (`types.ts`).
- Produces (consumed by Tasks 3/4/5):
  - `ProviderErrorKind` — the closed R1 taxonomy (Global Constraints): `"timeout" | "rate-limit" | "http-5xx" | "unavailable"` (fallback-eligible) | `"bad-request" | "auth" | "contract" | "configuration" | "fatal"` (fatal).
  - `classifyErrorKind(error: Error & { code?: string; retryable?: boolean }, stderr?: string): ProviderErrorKind` — the **pure, closed classification function** (Global Constraints "R1 Error Taxonomy"). No executor or runtime hard-codes a classification; they all call this.
  - `ProviderRunResult { output?: unknown; error?: string; errorKind?: ProviderErrorKind }`.
  - `ProviderExecutor { run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> }`.
  - `isFallbackEligibleKind(kind: ProviderErrorKind | undefined): boolean` — the R1 gate (provider-failure → true; capability/fatal → false; `undefined` → false).
  - `NativeProviderExecutor`, `ToolProviderExecutor`, `UnavailableProviderExecutor`.
  - `ProviderExecutorRegistry { register(type, executor): void; get(type): ProviderExecutor | undefined; has(type): boolean; listTypes(): ProviderType[] }` — `register` throws on duplicate.
  - `ProviderCandidate` (carries provider identity — Global Constraints "Candidate metadata"):
    ```ts
    interface ProviderCandidate {
      binding: CapabilityProviderBinding;
      providerId: string;       // = binding.id ("gitnexus", "gh")
      providerType: ProviderType;
      bindingIndex: number;     // position in bindings[]
      executor: ProviderExecutor;
    }
    ```

- [ ] **Step 1: Write the failing tests**

Create `tests/capability/provider-registry.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';

describe('ProviderExecutorRegistry', () => {
  it('registers and retrieves a provider by type', () => {
    const reg = new ProviderExecutorRegistry();
    const exec = new NativeProviderExecutor(new NativeExecutor());
    reg.register('native', exec);
    expect(reg.get('native')).toBe(exec);
    expect(reg.has('native')).toBe(true);
    expect(reg.listTypes()).toEqual(['native']);
  });

  it('returns undefined for an unregistered type', () => {
    expect(new ProviderExecutorRegistry().get('mcp')).toBeUndefined();
  });

  it('rejects duplicate registration for the same type', () => {
    const reg = new ProviderExecutorRegistry();
    reg.register('native', new NativeProviderExecutor(new NativeExecutor()));
    expect(() => reg.register('native', new NativeProviderExecutor(new NativeExecutor()))).toThrow(/already registered/i);
  });
});
```

Create `tests/capability/provider-executor.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NativeExecutor } from '../../src/capability/executors.js';
import {
  NativeProviderExecutor, ToolProviderExecutor, UnavailableProviderExecutor,
  isFallbackEligibleKind, classifyErrorKind,
} from '../../src/capability/provider-executor.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';
import type { CapabilityProviderBinding } from '../../src/capability/canonical/provider.js';
import type { ToolCallRequest } from '../../src/tools/types.js';
import type { ExecuteResult } from '../../src/tools/executor.js';

function cap(id = 'core.echo'): Capability {
  return { id, version: '1.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy: 'native', timeout: 5000, cancellable: true } };
}
function ctx(): CapabilityContext {
  return { invocationId: 'i', requestId: 'r', actor: 'operator', permissions: ['operator'],
    cwd: '/', workspace: '/', sessionId: 's', cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} } };
}
function binding(over: Partial<CapabilityProviderBinding> = {}): CapabilityProviderBinding {
  return { id: 'gh', type: 'external-cli', ...over };
}

describe('classifyErrorKind — closed R1 taxonomy', () => {
  const err = (code?: string) => Object.assign(new Error('boom'), code ? { code } : {});
  it('classifies process spawn codes', () => {
    expect(classifyErrorKind(err('ENOENT'))).toBe('unavailable');       // executable missing
    expect(classifyErrorKind(err('ETIMEDOUT'))).toBe('timeout');
    expect(classifyErrorKind(err('ABORT_ERR'))).toBe('timeout');
  });
  it('classifies tool-retryable vs tool-fatal (ToolProviderExecutor path)', () => {
    expect(classifyErrorKind(err(), undefined, true)).toBe('unavailable');
    expect(classifyErrorKind(err(), undefined, false)).toBe('fatal');
  });
  it('classifies CLI exit stderr', () => {
    expect(classifyErrorKind(err(), 'HTTP 429 Too Many Requests')).toBe('rate-limit');
    expect(classifyErrorKind(err(), '500 Internal Server Error')).toBe('http-5xx');
    expect(classifyErrorKind(err(), 'boom')).toBe('fatal');   // unclassified stderr → fail-closed
  });
  it('defaults an unclassified error to fatal (fail-closed)', () => {
    expect(classifyErrorKind(err())).toBe('fatal');
  });
});

describe('isFallbackEligibleKind', () => {
  it('classifies timeout/rate-limit/http-5xx/unavailable as fallback-eligible', () => {
    for (const k of ['timeout', 'rate-limit', 'http-5xx', 'unavailable'] as const) {
      expect(isFallbackEligibleKind(k)).toBe(true);
    }
  });
  it('classifies bad-request/auth/contract/configuration/fatal as fatal', () => {
    for (const k of ['bad-request', 'auth', 'contract', 'configuration', 'fatal'] as const) {
      expect(isFallbackEligibleKind(k)).toBe(false);
    }
  });
  it('classifies undefined as fatal (no fallback on an unclassified error)', () => {
    expect(isFallbackEligibleKind(undefined)).toBe(false);
  });
});

describe('NativeProviderExecutor', () => {
  it('delegates to the native handler keyed by capability.id', async () => {
    const native = new NativeExecutor();
    native.registerHandler('core.echo', async () => ({ output: 'hello' }));
    const exec = new NativeProviderExecutor(native);
    const result = await exec.run(binding({ type: 'native' }), cap(), ctx(), {});
    expect(result).toEqual({ output: 'hello' });
  });
});

describe('ToolProviderExecutor', () => {
  function makeTool(run: (req: ToolCallRequest) => Promise<ExecuteResult>) {
    return new ToolProviderExecutor({ execute: run });
  }
  it('uses binding.config.toolName and maps success output', async () => {
    const exec = makeTool(async (req) => {
      expect(req.name).toBe('file.read');
      return { kind: 'success', output: 'content' };
    });
    const result = await exec.run(binding({ type: 'tool', config: { toolName: 'file.read' } }), cap(), ctx(), {});
    expect(result).toEqual({ output: 'content' });
  });
  it('maps a retryable error to fallback-eligible unavailable', async () => {
    const exec = makeTool(async () => ({ kind: 'error', message: 'upstream', retryable: true }));
    const result = await exec.run(binding({ type: 'tool' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('unavailable');
  });
  it('maps a non-retryable error to fatal', async () => {
    const exec = makeTool(async () => ({ kind: 'error', message: 'bad args' }));
    const result = await exec.run(binding({ type: 'tool' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('fatal');
  });
});

describe('UnavailableProviderExecutor', () => {
  it('returns a fallback-eligible provider_unavailable for an unimplemented class', async () => {
    const result = await new UnavailableProviderExecutor('daemon').run(binding({ type: 'daemon' }), cap(), ctx(), {});
    expect(result.error).toMatch(/not implemented/i);
    expect(result.errorKind).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/capability/provider-registry.vitest.ts tests/capability/provider-executor.vitest.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `src/capability/provider-registry.ts`**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { ProviderType, CapabilityProviderBinding } from "./canonical/provider.js";
import type { ProviderExecutor } from "./provider-executor.js";

/** A binding paired with its resolved executor — what the runtime attempts.
 *  Carries provider identity (Global Constraints "Candidate metadata"): the
 *  bindingIndex is the ORIGINAL bindings[] position, never the filtered index. */
export interface ProviderCandidate {
  binding: CapabilityProviderBinding;
  providerId: string;       // = binding.id ("gitnexus", "gh")
  providerType: ProviderType;
  bindingIndex: number;
  executor: ProviderExecutor;
}

/** Type-keyed provider registry (user ruling): ONE executor per provider class.
 *  Instance identity lives in binding.id/binding.config, never here.
 *  register() rejects duplicates — deterministic wiring. */
export class ProviderExecutorRegistry {
  private byType = new Map<ProviderType, ProviderExecutor>();

  register(type: ProviderType, executor: ProviderExecutor): void {
    if (this.byType.has(type)) {
      throw new Error(`capability: provider type '${type}' already registered (duplicate registration rejected)`);
    }
    this.byType.set(type, executor);
  }

  get(type: ProviderType): ProviderExecutor | undefined { return this.byType.get(type); }
  has(type: ProviderType): boolean { return this.byType.has(type); }
  listTypes(): ProviderType[] { return [...this.byType.keys()]; }
}
```

- [ ] **Step 4: Create `src/capability/provider-executor.ts`**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { Capability, CapabilityContext } from "./types.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";
import type { NativeExecutor } from "./executors.js";
import type { ToolCallRequest } from "../tools/types.js";
import type { ExecuteResult } from "../tools/executor.js";

/** R1 error classes (wf-r1 §4.2). timeout/429/5xx/unavailable may fail over;
 *  400-class/auth/contract/configuration are fatal (no fallback). */
export type ProviderErrorKind =
  | "timeout" | "rate-limit" | "http-5xx" | "unavailable"
  | "fatal" | "bad-request" | "auth" | "contract" | "configuration";

export interface ProviderRunResult {
  output?: unknown;
  error?: string;
  errorKind?: ProviderErrorKind;   // present iff error
}

/** One provider execution attempt for one binding. The runtime walks a
 *  step's ordered candidates; isFallbackEligibleKind decides failover. */
export interface ProviderExecutor {
  run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult>;
}

const FALLBACK_ELIGIBLE = new Set<ProviderErrorKind>(["timeout", "rate-limit", "http-5xx", "unavailable"]);

/** Deterministic R1 gate: unclassified/undefined errors are fatal. */
export function isFallbackEligibleKind(kind: ProviderErrorKind | undefined): boolean {
  return kind !== undefined && FALLBACK_ELIGIBLE.has(kind);
}

/** The closed R1 classification function (Global Constraints taxonomy).
 *  Every executor and the runtime call THIS — no scattered instanceof or
 *  status-code logic. Provider failures (ENOENT/timeout/429/5xx) are
 *  fallback-eligible; capability/fatal failures are not.
 *  @param error - a thrown error (carries an optional process-exit `code`).
 *  @param stderr - optional CLI stderr (for 429 / 5xx classification).
 *  @param retryable - optional ToolResult.retryable (tool-adapter path). */
export function classifyErrorKind(
  error: { code?: string; retryable?: boolean; message?: string },
  stderr?: string,
  retryable?: boolean,
): ProviderErrorKind {
  if (retryable === true) return "unavailable";
  if (retryable === false) return "fatal";
  if (stderr !== undefined) {
    const s = stderr.toLowerCase();
    if (/\b429\b/.test(s)) return "rate-limit";
    if (/\b5\d\d\b/.test(s)) return "http-5xx";
  }
  switch (error?.code) {
    case "ENOENT": return "unavailable";
    case "ETIMEDOUT": case "ABORT_ERR": return "timeout";
  }
  return "fatal";   // fail-closed
}

/** The ToolExecutor.execute() seam CAP-4 adapts (matches tools/types.ts). */
export type ToolExecutorLike = { execute(req: ToolCallRequest): Promise<ExecuteResult> };

/** Wraps the CAP-3 NativeExecutor (handlers keyed by capability.id). Binding is
 *  ignored — native is a single implementation. Keeps NativeExecutor untouched. */
export class NativeProviderExecutor implements ProviderExecutor {
  constructor(private readonly native: NativeExecutor) {}
  async run(_binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    return this.native.run(capability, ctx, args);
  }
}

/** Adapts the existing ToolExecutor.execute() seam to a provider executor.
 *  toolName rides binding.config.toolName (legacy adapter places it there). */
export class ToolProviderExecutor implements ProviderExecutor {
  constructor(private readonly tool: ToolExecutorLike) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const toolName = (binding.config?.toolName as string | undefined) ?? capability.id;
    const req: ToolCallRequest = { toolCallId: `cap_${Date.now()}`, name: toolName, args };
    const result = await this.tool.execute(req);
    if (result.kind === "error") return { error: result.message, errorKind: classifyErrorKind(result, undefined, result.retryable) };
    if (result.kind === "denied") return { error: result.reason, errorKind: "fatal" };
    return { output: result.content ?? result.output ?? result.value };
  }
}

/** Deterministic stub for recognized-but-unimplemented provider classes
 *  (daemon/agent/plugin/remote-api). The binding exists; the implementation
 *  is unavailable — so this is fallback-eligible provider_unavailable, NOT
 *  missing_binding (user ruling). */
export class UnavailableProviderExecutor implements ProviderExecutor {
  constructor(private readonly providerType: ProviderType) {}
  async run(_binding: CapabilityProviderBinding, _capability: Capability, _ctx: CapabilityContext, _args: Record<string, unknown>): Promise<ProviderRunResult> {
    return { error: `Provider type '${this.providerType}' is not implemented (CAP-4)`, errorKind: "unavailable" };
  }
}
```

- [ ] **Step 5: Run the two test files**

Run: `pnpm exec vitest run tests/capability/provider-registry.vitest.ts tests/capability/provider-executor.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/capability/provider-registry.ts src/capability/provider-executor.ts tests/capability/provider-registry.vitest.ts tests/capability/provider-executor.vitest.ts
git commit -m "feat(capability): CAP-4 provider registry (type-keyed) + executor seam"
```

---

### Task 3: MCP + external-cli provider executors (pure additions)

**Files:**
- Modify: `src/capability/provider-executor.ts` (append `McpProviderExecutor` + `ExternalCliProviderExecutor`)
- Test: `tests/capability/provider-executor.vitest.ts` (append MCP + external-cli suites)

**Interfaces:**
- Consumes: `ToolResult` (`tools/types.ts`); `ProviderRunResult`/`ProviderErrorKind` (Task 2); `CapabilityProviderBinding` config conventions.
- Produces (consumed by Task 6 / tests): `McpProviderExecutor({ callTool })`; `ExternalCliProviderExecutor(spawn?)` with default `node:child_process` spawn; the `SpawnLike` seam.
- **Binding config contract (lock it):** external-cli → `{ executable: string; operation?: string[]; args?: string[] }`; mcp → `{ toolName?: string }` (falls back to `binding.id`). `gh` implements `github.issue.create` via `{ executable: "gh", operation: ["issue", "create"] }`; `gitnexus` implements `code.repository.impact` via `{ executable: "gitnexus", operation: ["impact"] }`.

- [ ] **Step 1: Append the failing tests to `tests/capability/provider-executor.vitest.ts`**

Add imports:

```ts
import { McpProviderExecutor, ExternalCliProviderExecutor, type SpawnLike } from '../../src/capability/provider-executor.js';
```

Add suites:

```ts
describe('McpProviderExecutor', () => {
  it('calls the MCP tool and returns output', async () => {
    const calls: string[] = [];
    const exec = new McpProviderExecutor({ callTool: async (name, _args) => { calls.push(name); return { kind: 'success', output: 'ok' }; } });
    const result = await exec.run(binding({ type: 'mcp', id: 'mcp:github', config: { toolName: 'github.issue.create' } }), cap(), ctx(), {});
    expect(calls).toEqual(['github.issue.create']);
    expect(result.output).toBe('ok');
  });
  it('falls back to binding.id as the tool name when config.toolName is absent', async () => {
    const calls: string[] = [];
    const exec = new McpProviderExecutor({ callTool: async (name) => { calls.push(name); return { kind: 'success' }; } });
    await exec.run(binding({ type: 'mcp', id: 'mcp:github' }), cap(), ctx(), {});
    expect(calls).toEqual(['mcp:github']);
  });
  it('maps an error result to fatal (or unavailable when retryable)', async () => {
    const fatal = new McpProviderExecutor({ callTool: async () => ({ kind: 'error', message: 'denied' }) });
    expect((await fatal.run(binding({ type: 'mcp' }), cap(), ctx(), {})).errorKind).toBe('fatal');
    const retryable = new McpProviderExecutor({ callTool: async () => ({ kind: 'error', message: 'busy', retryable: true }) });
    expect((await retryable.run(binding({ type: 'mcp' }), cap(), ctx(), {})).errorKind).toBe('unavailable');
  });
});

describe('ExternalCliProviderExecutor', () => {
  function fakeSpawn(record: { cmd: string; args: string[] }[]) {
    const spawn: SpawnLike = async (cmd, args, opts) => { record.push({ cmd, args }); return { exitCode: 0, stdout: 'out', stderr: '' }; };
    return spawn;
  }
  it('spawns the executable with operation args and a --json invocation payload', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    const result = await exec.run(
      binding({ type: 'external-cli', id: 'gitnexus', config: { executable: 'gitnexus', operation: ['impact'] } }),
      cap('code.repository.impact'), ctx(), { file: 'src/x.ts' });
    expect(record[0]).toEqual({ cmd: 'gitnexus', args: ['impact', '--json', JSON.stringify({ file: 'src/x.ts' })] });
    expect(result.output).toBe('out');
  });
  it('gh implements github.issue.create with its operation', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    await exec.run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh', operation: ['issue', 'create'] } }), cap('github.issue.create'), ctx(), { title: 'x' });
    expect(record[0]!.cmd).toBe('gh');
    expect(record[0]!.args[0]).toBe('issue');
    expect(record[0]!.args[1]).toBe('create');
  });
  it('ENOENT (executable missing) is fallback-eligible provider_unavailable', async () => {
    const spawn: SpawnLike = async () => { const e = new Error('spawn gh ENOENT') as Error & { code: string }; e.code = 'ENOENT'; throw e; };
    const exec = new ExternalCliProviderExecutor(spawn);
    const result = await exec.run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh' } }), cap(), ctx(), {});
    expect(result.errorKind).toBe('unavailable');
    expect(result.error).toMatch(/ENOENT|not found/i);
  });
  it('a missing config.executable is a fatal configuration error', async () => {
    const record: { cmd: string; args: string[] }[] = [];
    const exec = new ExternalCliProviderExecutor(fakeSpawn(record));
    const result = await exec.run(binding({ type: 'external-cli', id: 'gh' }), cap(), ctx(), {});
    expect(result.errorKind).toBe('configuration');
    expect(record).toHaveLength(0);   // nothing spawned
  });
  it('a timeout is a fallback-eligible timeout', async () => {
    const spawn: SpawnLike = async () => { const e = new Error('timed out') as Error & { code: string }; e.code = 'ETIMEDOUT'; throw e; };
    const result = await new ExternalCliProviderExecutor(spawn).run(binding({ type: 'external-cli', id: 'gh', config: { executable: 'gh' } }), cap(), ctx(), {});
    expect(result.errorKind).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/capability/provider-executor.vitest.ts`
Expected: FAIL — `McpProviderExecutor`/`ExternalCliProviderExecutor`/`SpawnLike` undefined.

- [ ] **Step 3: Append the two executors to `src/capability/provider-executor.ts`**

Add imports at the top (append to the existing import block):

```ts
import { execFile } from "node:child_process";
import type { ToolResult } from "../tools/types.js";
```

Add after `UnavailableProviderExecutor`:

```ts
/** MCP tool invocation seam — mirrors McpManager.callTool's ToolResult shape. */
export interface McpToolRunner {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/** MCP provider executor. toolName = binding.config.toolName ?? binding.id.
 *  An MCP server is a provider boundary (ADR-0013 MCP rule); protocol plumbing
 *  is never a capability — only intentional operations bound here. */
export class McpProviderExecutor implements ProviderExecutor {
  constructor(private readonly tools: McpToolRunner) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, _ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const toolName = (binding.config?.toolName as string | undefined) ?? binding.id;
    const result = await this.tools.callTool(toolName, args);
    if (result.kind === "error") return { error: result.message, errorKind: classifyErrorKind(result, undefined, result.retryable) };
    return { output: result.content ?? result.output ?? result.value };
  }
}

/** Spawn seam — injectable so tests never run real executables.
 *  Resolves { exitCode, stdout, stderr } or throws with a `.code`
 *  (ENOENT / ETIMEDOUT / ABORT_ERR). */
export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function defaultSpawn(cmd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs, signal: opts.signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const e = error as NodeJS.ErrnoException & { code?: string };
        if (e.code !== undefined) {
          const wrapped = new Error(`external-cli ${cmd}: ${e.message}`) as Error & { code?: string };
          wrapped.code = e.code;
          reject(wrapped);
        } else {
          reject(new Error(`external-cli ${cmd} failed: ${e.message}`));
        }
        return;
      }
      resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

/** External CLI provider executor (ADR-0013 external-CLI rule). The provider
 *  owns executable resolution, argument construction, env, timeout, capture,
 *  exit-code interpretation. One executor serves gh/gitnexus/kubectl/… —
 *  instance identity + config come from the binding. */
export class ExternalCliProviderExecutor implements ProviderExecutor {
  constructor(private readonly spawn: SpawnLike = defaultSpawn) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const config = (binding.config ?? {}) as { executable?: string; operation?: string[]; args?: string[]; timeoutMs?: number };
    const executable = config.executable;
    if (!executable) {
      return { error: `external-cli binding '${binding.id}' is missing config.executable`, errorKind: "configuration" };
    }
    const cliArgs = [...(config.operation ?? []), ...(config.args ?? [])];
    if (Object.keys(args).length > 0) cliArgs.push("--json", JSON.stringify(args));
    const timeoutMs = config.timeoutMs;
    try {
      const res = await this.spawn(executable, cliArgs, { timeoutMs, signal: ctx.cancellationToken });
      if (res.exitCode === 0) return { output: res.stdout };
      return { error: `${executable} exited ${res.exitCode}: ${res.stderr}`, errorKind: classifyErrorKind({}, res.stderr) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), errorKind: classifyErrorKind(e as { code?: string }) };
    }
  }
}
```

- [ ] **Step 4: Run the test file**

Run: `pnpm exec vitest run tests/capability/provider-executor.vitest.ts`
Expected: PASS (all suites incl. new MCP + external-cli).

- [ ] **Step 5: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/capability/provider-executor.ts tests/capability/provider-executor.vitest.ts
git commit -m "feat(capability): CAP-4 MCP + external-cli provider executors"
```

---

### Task 4: Provider resolver (pure addition — legacy `ExecutionResolver` stays until Task 5)

**Files:**
- Create: `src/capability/provider-resolver.ts`
- Test: `tests/capability/provider-resolver.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityRegistry.get` (canonical `RegisteredCapability`), `ProviderExecutorRegistry` (Task 2), `CapabilityProviderBinding`/`ProviderCandidate`, `CapabilityNotFoundError` (`errors.ts`), `CapabilityContext`.
- Produces (consumed by Task 5): `ProviderPlanStep { capabilityId: string; candidates: ProviderCandidate[]; bindingsCount: number; timeout: number; hooks: HookName[]; permissions: Permission[] }`; `ProviderPlan { capabilityId: string; steps: ProviderPlanStep[]; retryPolicy?; scheduling? }`; `ProviderResolver.resolve(capabilityId, ctx): ProviderPlan[]`; `HookName = keyof CapabilityHooks`.
- **Eligibility (lock it):** a binding is eligible iff (a) `providers.has(binding.type)` AND (b) the optional `isProviderHealthy` probe returns true (default healthy). Composition (dependencies-first, cycle detection) is preserved from the legacy resolver. **Pinning (user refinement): `allowFallbacks === false` → resolve over `bindings.slice(0, 1)` — only `bindings[0]` participates; if it is ineligible, `candidates = []` (STOP, never `bindings[1]`).** `timeout` = first candidate's `binding.config.timeout` (number) ?? 30_000.

- [ ] **Step 1: Write the failing tests — create `tests/capability/provider-resolver.vitest.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityContext } from '../../src/capability/types.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap4-resolver-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function ctx(): CapabilityContext {
  return { invocationId: 'i', requestId: 'r', actor: 'operator', permissions: ['operator'],
    cwd: '/', workspace: '/', sessionId: 's', cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} } };
}
function makeProviderExecutorRegistry() {
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return providers;
}
function def(over: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('ProviderResolver', () => {
  it('resolves a native capability to a single-step plan with one candidate', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans).toHaveLength(1);
    expect(plans[0]!.capabilityId).toBe('core.echo');
    expect(plans[0]!.steps).toHaveLength(1);
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(1);
    expect(plans[0]!.steps[0]!.candidates[0]!.binding.type).toBe('native');
  });

  it('candidates preserve bindings order (best-first)', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [
      { id: 'gh', type: 'external-cli', config: { executable: 'gh' } },
      { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
      { id: 'core.echo', type: 'native' },
    ] })]);
    const providers = makeProviderExecutorRegistry();
    // mcp + external-cli are NOT registered here → only native is eligible.
    const plans = new ProviderResolver(reg, providers).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['core.echo']);
  });

  it('filters bindings whose provider type has no registered executor', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [{ id: 'gh', type: 'external-cli', config: { executable: 'gh' } }] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(0);
    expect(plans[0]!.steps[0]!.bindingsCount).toBe(1);   // bindings existed; provider unavailable
  });

  it('allowFallbacks default true keeps every eligible candidate', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: true, bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(2);
  });

  it('allowFallbacks false pins to binding[0] only when eligible', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: false, bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['native.a']);
  });

  it('allowFallbacks false with an ineligible binding[0] yields no candidates (STOP, not fallthrough)', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: false, bindings: [
      { id: 'gh', type: 'external-cli', config: { executable: 'gh' } },
      { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(0);   // must NOT proceed to binding[1]
  });

  it('excludes bindings rejected by the isProviderHealthy probe', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const resolver = new ProviderResolver(reg, makeProviderExecutorRegistry(), {
      isProviderHealthy: (b) => b.id === 'native.b',   // native.a is circuit-open/unhealthy
    });
    const plans = resolver.resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['native.b']);
  });

  it('builds multi-step plans with dependencies first (composition preserved)', () => {
    const reg = makeRegistry();
    reg.import([def({ id: 'dep.a' }), def({ id: 'dep.b' }), def({ id: 'core.composed', dependencies: ['dep.a', 'dep.b'] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.composed', ctx());
    expect(plans[0]!.steps.map((s) => s.capabilityId)).toEqual(['dep.a', 'dep.b', 'core.composed']);
  });

  it('rejects a cyclic dependency graph', () => {
    const reg = makeRegistry();
    reg.import([def({ id: 'cyc.a', dependencies: ['cyc.b'] }), def({ id: 'cyc.b', dependencies: ['cyc.a'] })]);
    expect(() => new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('cyc.a', ctx())).toThrow(/cycle|circular/i);
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    expect(() => new ProviderResolver(makeRegistry(), makeProviderExecutorRegistry()).resolve('nope.missing', ctx())).toThrow(CapabilityNotFoundError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/capability/provider-resolver.vitest.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/capability/provider-resolver.ts`**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityNotFoundError } from "./errors.js";
import type { CapabilityContext, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";
import type { ProviderExecutorRegistry, ProviderCandidate } from "./provider-registry.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";
import type { CapabilityDefinition } from "./canonical/definition.js";

export type HookName = keyof CapabilityHooks;

export interface ProviderPlanStep {
  /** The capability this step invokes (a dependency, or the plan's own
   *  capability for the final step). Identity is provider-independent (#476). */
  capabilityId: string;
  /** Ordered, eligibility-filtered provider candidates — the bounded
   *  single-pass fallback list. Empty = missing_binding or provider_unavailable. */
  candidates: ProviderCandidate[];
  /** Original binding count (pre-filter): distinguishes missing_binding (0)
   *  from provider_unavailable (>0 but none eligible). */
  bindingsCount: number;
  timeout: number;
  hooks: HookName[];
  permissions: Permission[];
}

export interface ProviderPlan {
  capabilityId: string;
  steps: ProviderPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;

/** CAP-4 provider resolver — replaces strategy-keyed ExecutionResolver dispatch.
 *  Deterministic candidate selection (bindings order + eligibility + pin);
 *  the runtime owns the attempt/failover walk. Identity never changes here. */
export class ProviderResolver {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly providers: ProviderExecutorRegistry,
    private readonly opts: { isProviderHealthy?: (binding: CapabilityProviderBinding) => boolean } = {},
  ) {}

  resolve(capabilityId: string, _ctx: CapabilityContext): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const steps = this.buildSteps(rc.definition, [], new Set());
    return [{ capabilityId, steps }];
  }

  private buildSteps(def: CapabilityDefinition, chain: string[], visited: Set<string>): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(' → ')}`);
    }
    const steps: ProviderPlanStep[] = [];
    const nextChain = [...chain, def.id];
    for (const depId of def.dependencies ?? []) {
      if (visited.has(depId)) continue;
      const dep = this.registry.get(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildSteps(dep.definition, nextChain, visited));
      visited.add(depId);
    }
    steps.push(this.stepFor(def));
    return steps;
  }

  private isEligible(binding: CapabilityProviderBinding): boolean {
    if (!this.providers.has(binding.type)) return false;
    return this.opts.isProviderHealthy ? this.opts.isProviderHealthy(binding) : true;
  }

  private stepFor(def: CapabilityDefinition): ProviderPlanStep {
    // Pinning (user refinement): allowFallbacks=false resolves over a bounded
    // list of ONE — only bindings[0] participates; if it is ineligible, the
    // result is [] (STOP). The pin applies BEFORE candidate traversal.
    const bounded = def.allowFallbacks === false ? def.bindings.slice(0, 1) : def.bindings;
    // Preserve the ORIGINAL bindings[] position in bindingIndex (the eligible
    // subset is filtered, so its own indices would be wrong).
    const candidates: ProviderCandidate[] = bounded
      .map((binding, bindingIndex) => ({ binding, bindingIndex }))
      .filter(({ binding }) => this.isEligible(binding))
      .map(({ binding, bindingIndex }) => ({
        binding,
        providerId: binding.id,
        providerType: binding.type,
        bindingIndex,
        executor: this.providers.get(binding.type)!,
      }));
    const first = candidates[0];
    const timeout = typeof first?.binding.config?.timeout === "number" ? first.binding.config.timeout : DEFAULT_TIMEOUT;
    return {
      capabilityId: def.id,
      candidates,
      bindingsCount: def.bindings.length,
      timeout,
      hooks: [],
      permissions: [...def.requiredPermissions],
    };
  }
}
```

- [ ] **Step 4: Run the test file**

Run: `pnpm exec vitest run tests/capability/provider-resolver.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/capability/provider-resolver.ts tests/capability/provider-resolver.vitest.ts
git commit -m "feat(capability): CAP-4 provider resolver (ordered, eligibility-filtered candidates)"
```

---

### Task 5: Runtime fallback dispatch + platform wiring (redrawn boundary, part 1)

**Files:**
- Modify: `src/capability/runtime.ts` (dispatch via candidates + fallback walk + exhaustion → availability)
- Modify: `src/capability/types.ts` (additive, optional — `InvocationResult.servingProvider?: { providerId: string; providerType: string; bindingIndex: number }`; the legacy `Capability`/`CapabilityExecution` shape is untouched)
- Modify: `src/capability/errors.ts` (add `ProviderUnavailableError`)
- Modify: `src/capability/platform.ts` (wire `ProviderExecutorRegistry` + `ProviderResolver`; `registerProvider`; drop `ExecutorRegistry`/`registerExecutor`)
- Modify: `src/capability/tool-adapter.ts` (`createToolExecutorAdapter` → `createToolProviderExecutor`)
- Modify: `src/capability/provider-executor.ts` (export `ToolExecutorLike`)
- Modify: `src/tui/capabilities/capability-service.ts:83` (`registerProvider('tool', createToolProviderExecutor(...))`)
- Test: `tests/capability/runtime.vitest.ts` (setup rewrite + `ExecutorNotFoundError` → `ProviderUnavailableError`)
- Test: `tests/capability/tool-adapter.vitest.ts` (rewrite for `createToolProviderExecutor`)
- Test: create `tests/capability/fallback.vitest.ts` (the R1 acceptance suite)

**Interfaces:**
- Consumes: `ProviderPlanStep` (Task 4), `ProviderRunResult`/`isFallbackEligibleKind`/`classifyErrorKind` (Task 2), `ProviderUnavailableError` (this task).
- Produces: `CapabilityRuntime` now constructs as `(registry, hooks, resolver: ProviderResolver, bus)` — 4 args (the executor registry is dropped; candidates carry their executors). `CapabilityPlatform.registerProvider(type, executor)` (the composition seam callers use). `errors.ts` exports `ProviderUnavailableError`. `InvocationResult.servingProvider?: { providerId; providerType; bindingIndex }` (additive — the serving provider is a first-class execution fact; Task 6's barrel exports it via `types.ts`).

- [ ] **Step 1: Add `ProviderUnavailableError` to `src/capability/errors.ts`**

Append:

```ts
export class ProviderUnavailableError extends Error {
  constructor(capabilityId: string, reason: "missing_binding" | "provider_unavailable" = "provider_unavailable") {
    super(`No available provider for capability '${capabilityId}' (${reason})`);
    this.name = "ProviderUnavailableError";
  }
}
```

- [ ] **Step 2: Rewrite the dispatch in `src/capability/runtime.ts`**

Update imports (replace the resolver/executor/error imports):

```ts
import { CapabilityNotFoundError, ProviderUnavailableError } from "./errors.js";
import { AsyncEventQueue, type CapabilityContext, type CapabilityEvent, type EventBusLike, type Invocation, type InvocationResult, type InvocationStatus, type Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { HookRegistry } from "./hook-registry.js";
import type { ProviderResolver } from "./provider-resolver.js";
import { isFallbackEligibleKind, classifyErrorKind, type ProviderRunResult } from "./provider-executor.js";
import type { EventBus } from "./event-bus.js";
```
(Drop `ExecutorRunResult`, `ExecutionResolver`, `ExecutorRegistry`, `ExecutorNotFoundError` imports.)

Change the constructor to 4 args:

```ts
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly hooks: HookRegistry,
    private readonly resolver: ProviderResolver,
    private readonly bus: EventBus,
  ) {}
```

Replace the single-step sync check:

```ts
    // Backward-compatible synchronous error for the single-step case: a
    // capability with no eligible provider throws immediately (the legacy
    // "missing executor" contract). Multi-step plans resolve providers
    // per-step in the async body and fail the composite instead.
    if (steps.length === 1 && steps[0]!.candidates.length === 0) {
      throw new ProviderUnavailableError(capabilityId, steps[0]!.bindingsCount === 0 ? "missing_binding" : "provider_unavailable");
    }
```

Replace the per-step executor loop (the `for (const step of steps) { ... }` body) AND update the post-loop completion to carry `servingProvider` (the existing `emitTerminal`/`finish`/`afterInvoke` lines — the `finish` gains `servingProvider: serving`; do not duplicate them):

```ts
        let stepArgs = args;
        for (const step of steps) {
          if (abort.signal.aborted) { inv.cancel(); return; }
          const stepCap = this.registry.find(step.capabilityId);
          if (!stepCap) return fail(`Unknown capability '${step.capabilityId}'`);
          // Nothing eligible to resolve: distinguish missing_binding (no
          // bindings declared) from provider_unavailable (bindings existed,
          // but no provider is usable). Availability change, NEVER a lifecycle
          // change (#476, #481).
          if (step.candidates.length === 0) {
            const reason = step.bindingsCount === 0 ? "missing_binding" : "provider_unavailable";
            this.registry.setAvailability(step.capabilityId, { available: false, reason });
            return fail(`No available provider for '${step.capabilityId}' (${reason})`);
          }
          let stepOutput: Record<string, unknown> | undefined;
          let served = false;
          let serving: { providerId: string; providerType: string; bindingIndex: number } | undefined;
          for (const candidate of step.candidates) {
            if (abort.signal.aborted) { inv.cancel(); return; }
            let runResult: ProviderRunResult;
            try {
              runResult = await candidate.executor.run(candidate.binding, stepCap, ctx, stepArgs);
            } catch (e) {
              // Execution threw → classify through the closed R1 function, not
              // a hard-coded "unavailable" (Global Constraints "R1 Taxonomy").
              runResult = { error: e instanceof Error ? e.message : String(e), errorKind: classifyErrorKind(e as { code?: string }) };
            }
            if (runResult.error !== undefined) {
              // R1 error-class gate: provider failure → next candidate
              // (bounded single pass); capability/fatal → fail immediately.
              if (isFallbackEligibleKind(runResult.errorKind)) continue;
              return fail(runResult.error);
            }
            stepOutput = (runResult.output ?? {}) as Record<string, unknown>;
            served = true;
            serving = { providerId: candidate.providerId, providerType: candidate.providerType, bindingIndex: candidate.bindingIndex };
            break;
          }
          if (!served) {
            this.registry.setAvailability(step.capabilityId, { available: false, reason: "provider_unavailable" });
            return fail(`No provider available for '${step.capabilityId}' (provider_unavailable)`);
          }
          stepArgs = stepOutput;
        }

        // The serving provider is a first-class execution fact (identity stays
        // the capability; the provider identity is what changes across attempts).
        emitTerminal({ type: "InvocationCompleted", invocationId, at: Date.now() });
        const r = finish("completed", { output: stepArgs, servingProvider: serving });
        await hooks?.afterInvoke?.(r, ctx);
```

- [ ] **Step 3: Rewire `src/capability/platform.ts`**

Replace imports and body (the `executors` field + `registerExecutor` are gone):

```ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ProviderResolver } from "./provider-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { NativeExecutor } from "./executors.js";
import { ProviderExecutorRegistry } from "./provider-registry.js";
import { NativeProviderExecutor, UnavailableProviderExecutor, type ProviderExecutor } from "./provider-executor.js";
import { EventBus } from "./event-bus.js";
import { CapabilityCatalog } from "./canonical/catalog.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { join } from "node:path";
import type { ProviderType } from "./canonical/provider.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";

/** Composition root (CAP-4): catalog → registry → mutation port → provider
 *  registry (native + recognized-unimplemented stubs) → provider resolver →
 *  runtime. Exactly ONE CapabilityRegistry per runtime universe lives here. */
export class CapabilityPlatform {
  readonly registry: CapabilityRegistry;
  readonly catalog: CapabilityCatalog;
  readonly hooks = new HookRegistry();
  readonly providers = new ProviderExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ProviderResolver;
  private readonly runtime: CapabilityRuntime;

  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog } = {}) {
    this.catalog = opts.catalog ?? new CapabilityCatalog(new CapabilityDefinitionStore({ dir: opts.catalogDir ?? join(process.cwd(), ".alix", "capabilities") }));
    this.registry = new CapabilityRegistry(this.catalog);
    this.registry.setMutationPort(new CatalogBackedCapabilityMutationPort(this.catalog));
    this.registry.setProviderBound((type) => this.providers.has(type as ProviderType));
    this.providers.register("native", new NativeProviderExecutor(this.native));
    // Recognized-but-unimplemented provider classes resolve deterministically
    // to provider_unavailable (fallback-eligible) — never missing_binding.
    for (const t of ["daemon", "agent", "plugin", "remote-api"] as const) {
      this.providers.register(t, new UnavailableProviderExecutor(t));
    }
    this.registry.attach(this.events);
    this.resolver = new ProviderResolver(this.registry, this.providers);
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.events);
  }

  register(capability: Capability): void { this.registry.register(capability); }
  find(id: string): Capability | undefined { return this.registry.find(id); }
  query(q: CapabilityQuery = {}): Capability[] { return this.registry.query(q); }

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    return this.runtime.invoke(capabilityId, args, overrides);
  }

  /** Composition seam for environment-dependent providers (tool, mcp,
   *  external-cli). Type-keyed — a duplicate type throws. */
  registerProvider(type: ProviderType, executor: ProviderExecutor): void {
    this.providers.register(type, executor);
  }
}
```

- [ ] **Step 4: Rewrite `src/capability/tool-adapter.ts`** (replaces `createToolExecutorAdapter`; `ToolExecutorLike` was exported in Task 2)

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { ToolProviderExecutor } from "./provider-executor.js";
import type { ToolExecutorLike } from "./provider-executor.js";

/** Adapts the existing ToolExecutor.execute() seam to the tool provider. */
export function createToolProviderExecutor(executor: ToolExecutorLike): ToolProviderExecutor {
  return new ToolProviderExecutor(executor);
}
```

- [ ] **Step 5: Update `src/tui/capabilities/capability-service.ts`**

Change the import + call site (line ~83):

```ts
import { createToolProviderExecutor } from '../../capability/tool-adapter.js';
...
      this.platform.registerProvider('tool', createToolProviderExecutor(this.opts.toolExecutor));
```

- [ ] **Step 6: Update `tests/capability/runtime.vitest.ts`**

Replace the setup imports/construction:

```ts
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { ProviderResolver } from '../../src/capability/provider-resolver.js';
import { ProviderUnavailableError } from '../../src/capability/errors.js';
import { NativeExecutor } from '../../src/capability/executors.js';
```
(Drop `ExecutorRegistry` + `ExecutionResolver` imports.)

Replace the per-test construction:

```ts
  const native = new NativeExecutor();
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(native));
  const runtime = new CapabilityRuntime(reg, hooks, new ProviderResolver(reg, providers), bus);
```

Replace the `ExecutorNotFoundError` test (the old one registered `execution: { strategy: 'does-not-exist' }`, which legacy-maps to a `tool` binding with no registered executor → empty candidates → synchronous throw):

```ts
  it('throws ProviderUnavailableError when the sole step has no eligible provider', () => {
    ... existing setup ...
    reg.register({ id: 'core.noop', version: '1.0', kind: 'core', title: 'Noop', description: 'x',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'does-not-exist' } });
    expect(() => runtime.invoke('core.noop', {}, { actor: 'operator', cwd: '/', workspace: '/' }))
      .toThrow(ProviderUnavailableError);
  });
```

- [ ] **Step 7: Rewrite `tests/capability/tool-adapter.vitest.ts`**

The test exercises the full platform path (`registerInitialCapabilities` seeds `tool.file.read`/`tool.shell.run` with `extensions.toolName`; the legacy adapter moves that into `binding.config.toolName`, which `ToolProviderExecutor` reads). Swap `createToolExecutorAdapter` + `registerExecutor` for `createToolProviderExecutor` + `registerProvider`:

```ts
import { describe, it, expect } from 'vitest';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { createToolProviderExecutor } from '../../src/capability/tool-adapter.js';
import type { ToolCallRequest, ToolResult } from '../../src/tools/types.js';

describe('tool provider executor', () => {
  function platformWithTool(tool: { execute(req: ToolCallRequest): Promise<ToolResult | { kind: 'denied'; reason: string }> }) {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    platform.registerProvider('tool', createToolProviderExecutor(tool));
    return platform;
  }

  it('runs tool.file.read through the existing ToolExecutor contract', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'success', content: 'file contents' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('file contents');
  });

  it('maps a denied result to an invocation failure', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult | { kind: 'denied'; reason: string }> => {
        if (req.name === 'shell.run') return { kind: 'denied', reason: 'Approval required' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.shell.run', { command: 'rm -rf /' }, { actor: 'admin', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Approval required');
  });

  it('maps an error result to an invocation failure', async () => {
    const platform = platformWithTool({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'error', message: 'boom' };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const result = await platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
```

- [ ] **Step 8: Create `tests/capability/fallback.vitest.ts` (the R1 acceptance suite)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityRuntime } from '../../src/capability/runtime.js';
import { ProviderResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor, ToolProviderExecutor, McpProviderExecutor, ExternalCliProviderExecutor, type SpawnLike } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { EventBus } from '../../src/capability/event-bus.js';
import type { CapabilityContext, ExecutorRunResult } from '../../src/capability/types.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { ToolCallRequest } from '../../src/tools/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap4-fallback-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function def(over: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }], ...over,
  };
}
type FakeCallTool = (name: string, args: Record<string, unknown>) => Promise<{ kind: 'success'; content?: string; output?: string } | { kind: 'error'; message: string; retryable?: boolean }>;
type FakeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult>;

function makeRuntime(opts: { mcp?: FakeCallTool; spawn?: SpawnLike; handlers?: Record<string, FakeHandler> }) {
  const reg = makeRegistry();
  const native = new NativeExecutor();
  for (const [id, h] of Object.entries(opts.handlers ?? {})) native.registerHandler(id, h);
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(native));
  if (opts.mcp) providers.register('mcp', new McpProviderExecutor({ callTool: opts.mcp }));
  if (opts.spawn) providers.register('external-cli', new ExternalCliProviderExecutor(opts.spawn));
  const bus = new EventBus();
  const runtime = new CapabilityRuntime(reg, new HookRegistry(), new ProviderResolver(reg, providers), bus);
  return { reg, runtime, providers, bus };
}

describe('CAP-4 R1 fallback contract', () => {
  it('fails over to the next candidate when the first returns a fallback-eligible error (ordered priority)', async () => {
    const order: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => { order.push('mcp'); return { kind: 'error', message: 'upstream', retryable: true }; },
      handlers: { 'code.repository.impact': async () => { order.push('native'); return { output: 'native-result' }; } },
    });
    reg.import([def({
      id: 'code.repository.impact', allowFallbacks: true, bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'impact' } },
        { id: 'code.repository.impact', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('code.repository.impact', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('native-result');
    expect(order).toEqual(['mcp', 'native']);   // bounded single pass
  });

  it('allowFallbacks false pins to binding[0]: exhaustion, no failover to binding[1]', async () => {
    const nativeCalls: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'busy', retryable: true }),
      handlers: { 'pinned.cap': async () => { nativeCalls.push('native'); return { output: 'native' }; } },
    });
    reg.import([def({
      id: 'pinned.cap', allowFallbacks: false, bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
        { id: 'pinned.cap', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('pinned.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(nativeCalls).toHaveLength(0);   // pin: never proceeds to binding[1]
    expect(reg.getAvailability('pinned.cap')).toEqual({ available: false, reason: 'provider_unavailable' });
    expect(reg.getLifecycleState('pinned.cap')).toBe('emerging');   // availability ≠ lifecycle
  });

  it('a fatal error fails immediately without trying the next candidate', async () => {
    const nativeCalls: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'malformed request', retryable: false }),
      handlers: { 'fatal.cap': async () => { nativeCalls.push('native'); return { output: 'native' }; } },
    });
    reg.import([def({
      id: 'fatal.cap', bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
        { id: 'fatal.cap', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('fatal.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/malformed request/);
    expect(nativeCalls).toHaveLength(0);   // fatal: no fallback
  });

  it('exhaustion marks provider_unavailable and leaves lifecycle unchanged', async () => {
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'upstream', retryable: true }),
    });
    reg.import([def({
      id: 'exhaust.cap', bindings: [
        { id: 'mcp:a', type: 'mcp', config: { toolName: 'a' } },
        { id: 'mcp:b', type: 'mcp', config: { toolName: 'b' } },
      ],
    })]);
    const result = await runtime.invoke('exhaust.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(reg.getAvailability('exhaust.cap')).toEqual({ available: false, reason: 'provider_unavailable' });
    expect(reg.getLifecycleState('exhaust.cap')).toBe('emerging');
    expect(result.servingProvider).toBeUndefined();   // failure never carries a provider identity
  });

  it('code.repository.impact keeps its identity across gitnexus→mcp→native fallback', async () => {
    const order: string[] = [];
    const { reg, runtime } = makeRuntime({
      spawn: async () => {
        order.push('gitnexus');
        const e = new Error('spawn gitnexus ENOENT') as Error & { code: string };
        e.code = 'ENOENT';
        throw e;
      },
      mcp: async () => { order.push('mcp'); return { kind: 'error', message: 'disconnected', retryable: true }; },
      handlers: { 'code.repository.impact': async () => { order.push('native'); return { output: 'impact-report' }; } },
    });
    reg.import([def({
      id: 'code.repository.impact', allowFallbacks: true, bindings: [
        { id: 'gitnexus', type: 'external-cli', config: { executable: 'gitnexus', operation: ['impact'] } },
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'impact' } },
        { id: 'code.repository.impact', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('code.repository.impact', { file: 'src/x.ts' }, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('impact-report');
    expect(order).toEqual(['gitnexus', 'mcp', 'native']);
    // Capability identity constant; provider identity changed across attempts (#476).
    expect(reg.get('code.repository.impact')!.definition.id).toBe('code.repository.impact');
    expect(result.servingProvider).toEqual({ providerId: 'code.repository.impact', providerType: 'native', bindingIndex: 2 });
  });

  it('capability failure (fatal) does NOT fall back; provider failure (unavailable) does — the acceptance distinction', async () => {
    // Two tool bindings, distinct toolNames: 'shell.run' fails fatally (a
    // deterministic rejection), 'fallback.run' fails with a provider outage.
    const calls: string[] = [];
    const exec = new ToolProviderExecutor({
      execute: async (req: ToolCallRequest) => {
        calls.push(req.name);
        if (req.name === 'shell.run') return { kind: 'error', message: 'Permission denied by policy', retryable: false };
        if (req.name === 'fallback.run') return { kind: 'error', message: 'upstream down', retryable: true };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const reg = makeRegistry();
    const providers = new ProviderExecutorRegistry();
    providers.register('tool', exec);
    const runtime = new CapabilityRuntime(reg, new HookRegistry(), new ProviderResolver(reg, providers), new EventBus());

    // Capability failure → STOP (native fallback binding never tried).
    reg.import([def({ id: 'fatal.cap', bindings: [
      { id: 'tool:shell', type: 'tool', config: { toolName: 'shell.run' } },
      { id: 'fatal.cap', type: 'native' },   // would succeed if tried
    ] })]);
    const fatal = await runtime.invoke('fatal.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(fatal.status).toBe('failed');
    expect(fatal.error).toBe('Permission denied by policy');

    // Provider failure → fallback (native binding serves).
    reg.import([def({ id: 'failover.cap', bindings: [
      { id: 'tool:fallback', type: 'tool', config: { toolName: 'fallback.run' } },
      { id: 'failover.cap', type: 'native' },
    ] })]);
    const native = new NativeExecutor();
    native.registerHandler('failover.cap', async () => ({ output: 'native-served' }));
    providers.register('native', new NativeProviderExecutor(native));
    const failover = await runtime.invoke('failover.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(failover.status).toBe('completed');
    expect(failover.output).toBe('native-served');
    expect(calls).toEqual(['shell.run', 'fallback.run']);   // shell.run NOT retried on the fatal path
  });

  it('a provider failure on one capability does not take down a sibling on the same provider', async () => {
    const { reg, runtime } = makeRuntime({
      handlers: {
        'broken.cap': async () => ({ error: 'segfault' }),
        'healthy.cap': async () => ({ output: 'fine' }),
      },
    });
    reg.import([def({ id: 'broken.cap', bindings: [{ id: 'broken.cap', type: 'native' }] })]);
    reg.import([def({ id: 'healthy.cap', bindings: [{ id: 'healthy.cap', type: 'native' }] })]);
    const broken = await runtime.invoke('broken.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(broken.status).toBe('failed');
    const healthy = await runtime.invoke('healthy.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(healthy.status).toBe('completed');
    expect(healthy.output).toBe('fine');
  });

  // NOTE (adjudicated at implementation): the canonical validator
  // (`validateCapabilityDefinition`) REQUIRES ≥1 binding, so `bindings: []`
  // cannot be registered — `missing_binding` is structurally unreachable via
  // the public API. The runtime keeps its defensive `missing_binding` branch
  // (locked vocabulary, future-proof for hand-edited catalogs), but there is
  // NO test for it — the sync-throw path's `bindingsCount === 0` ternary is
  // likewise defensive. This test was dropped as unbuildable.
});
```

> **Review checkpoint (Task 5, user-requested):** `servingProvider` must represent the provider that **actually produced the successful result** (gitnexus→mcp→native success → `servingProvider = native`), NOT merely the last candidate attempted. On complete failure, `servingProvider` must be **absent** (never a failed provider identity). The plan code satisfies this: `serving` is set only on the success branch; `fail()` never passes it. Enforced by the identity-stability test (`servingProvider = native`, `bindingIndex: 2`) and the exhaustion test (`servingProvider` undefined). The task reviewer should confirm both.

- [ ] **Step 9: Run the affected test files**

Run: `pnpm exec vitest run tests/capability/runtime.vitest.ts tests/capability/tool-adapter.vitest.ts tests/capability/fallback.vitest.ts tests/capability/platform.vitest.ts tests/capability/executors.vitest.ts`
Expected: PASS.

- [ ] **Step 9a: Prove every runtime path is provider-bound (legacy-free evidence)**

Run: `grep -rnE "\b(ExecutorRegistry|ExecutionResolver|CapabilityExecutor|ToolExecutorAdapter|registerExecutor)\b" src/capability/provider-executor.ts src/capability/provider-registry.ts src/capability/provider-resolver.ts src/capability/runtime.ts src/capability/platform.ts src/capability/tool-adapter.ts src/tui/capabilities/capability-service.ts`
Expected: NO code matches (word-boundary anchored — `ProviderExecutorRegistry` is a substring, not a word, so it does NOT match). The single expected exception is the `provider-resolver.ts` doc comment that NAMES `ExecutionResolver` in prose ("replaces strategy-keyed ExecutionResolver dispatch") — a comment is not a dependency; accept it. Everything else zero — no CAP-4 provider executor, the resolver, the registry, the runtime, the platform, the tool adapter, or the TUI service depends on the legacy strategy machinery (Global Constraints "No CAP-4 provider executor may depend on legacy"). The tool path is exercised by `tool-adapter.vitest.ts` (through the platform), the native path by `runtime.vitest.ts`, and mcp/external-cli/tool-fallback by `fallback.vitest.ts`. Task 6 is then pure deletion.

- [ ] **Step 10: Typecheck gate**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0. (Legacy `ExecutionResolver`/`ExecutorRegistry`/`ToolExecutorAdapter`/`CapabilityExecutor`/`createToolExecutorAdapter` remain exported but unused until Task 6 removes them — unused exports do not fail `tsc`.)

- [ ] **Step 11: Commit**

```bash
git add src/capability/runtime.ts src/capability/types.ts src/capability/errors.ts src/capability/platform.ts src/capability/tool-adapter.ts src/capability/provider-executor.ts src/tui/capabilities/capability-service.ts tests/capability/runtime.vitest.ts tests/capability/tool-adapter.vitest.ts tests/capability/fallback.vitest.ts
git commit -m "feat(capability): CAP-4 runtime fallback dispatch + platform provider wiring"
```

---

### Task 6: Remove legacy strategy dispatch (redrawn boundary, part 2)

**Files:**
- Delete: `src/capability/execution-resolver.ts`
- Delete: `tests/capability/execution-resolver.vitest.ts`
- Modify: `src/capability/executors.ts` (remove `CapabilityExecutor` interface, `ExecutorRegistry`, `ToolExecutorAdapter`; keep `NativeExecutor` + `NativeHandler`)
- Modify: `src/capability/tool-adapter.ts` (remove `createToolExecutorAdapter`)
- Modify: `src/capability/errors.ts` (remove `ExecutorNotFoundError` if no longer referenced)
- Modify: `src/capability/index.ts` (barrel: `execution-resolver.js` → `provider-resolver.js`; add `provider-registry.js` + `provider-executor.js`)
- Test: `tests/capability/executors.vitest.ts` (remove the `ExecutorRegistry` suite; keep `NativeExecutor`)

**Interfaces:**
- Consumes: everything from Tasks 1-5. No new behavior — pure deletion of the strategy-keyed dispatch surfaces.

- [ ] **Step 1: Confirm nothing imports the legacy symbols**

Run: `grep -rn "ExecutionResolver\|ExecutorRegistry\|CapabilityExecutor\|ToolExecutorAdapter\|createToolExecutorAdapter\|ExecutorNotFoundError" src/ tests/ --include="*.ts" | grep -v "execution-resolver.vitest"`
Expected: only `executors.vitest.ts` (the `ExecutorRegistry` suite — removed in Step 4) and the files being deleted/cleaned in this task. Anything else is a missed consumer — fix that consumer before deleting.

- [ ] **Step 2: Delete the legacy resolver + its test**

```bash
git rm src/capability/execution-resolver.ts tests/capability/execution-resolver.vitest.ts
```

- [ ] **Step 3: Trim `src/capability/executors.ts`**

Remove the `CapabilityExecutor` interface, the `ExecutorRegistry` class, and the `ToolExecutorAdapter` class. The file keeps exactly:

```ts
export type NativeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult> | ExecutorRunResult;

export class NativeExecutor implements CapabilityExecutor { ... }
```
→ remove the `implements CapabilityExecutor` clause; keep `registerHandler` + `run(capability, ctx, args)` (used by `NativeProviderExecutor`, `session-capabilities.ts`, and the forbidden `initial-capabilities.ts` type import). Keep the imports needed for the remaining code.

- [ ] **Step 4: Rewrite `tests/capability/executors.vitest.ts`**

Delete the `describe('ExecutorRegistry', ...)` block (lines ~21-28, which tested `new ExecutorRegistry().register('native', ...)` — the type-keyed `ProviderExecutorRegistry` now covers that in `provider-registry.vitest.ts`). Keep the `describe('NativeExecutor', ...)` suite unchanged.

- [ ] **Step 5: Trim `src/capability/tool-adapter.ts`**

The file now contains only `createToolProviderExecutor` (Task 5). Remove any leftover `createToolExecutorAdapter`/`ToolExecutorAdapter` references.

- [ ] **Step 6: Trim `src/capability/errors.ts`**

Remove `ExecutorNotFoundError` if Step 1 confirmed no references remain.

- [ ] **Step 7: Update `src/capability/index.ts` barrel**

```ts
export * from "./types.js";
export * from "./errors.js";
export * from "./registry.js";
export * from "./legacy-adapter.js";
export * from "./mutation-port.js";
export * from "./hook-registry.js";
export * from "./provider-resolver.js";   // was execution-resolver.js
export * from "./provider-registry.js";   // new (CAP-4)
export * from "./provider-executor.js";   // new (CAP-4)
export * from "./executors.js";
export * from "./event-bus.js";
export * from "./runtime.js";
export * from "./platform.js";
export * from "./initial-capabilities.js";
```

- [ ] **Step 8: Run the full capability + A7 suites + typecheck**

Run: `pnpm exec vitest run tests/capability`
Then: `pnpm exec vitest run tests/evolution/capability-lifecycle` (A7 lifecycle suite — uses the legacy registry adapter, must stay green)
Then: `pnpm exec tsc --noEmit`
Expected: all PASS; `tsc` exit 0.

- [ ] **Step 9: Structural check — no strategy-keyed dispatch remains**

Run: `grep -rn "execution\.strategy\|\.strategy\b" src/capability/runtime.ts src/capability/execution-resolver.ts 2>/dev/null`
Expected: `execution-resolver.ts` no longer exists; `runtime.ts` has no strategy-keyed dispatch (the only `strategy` mention left in the capability path is the legacy `Capability.execution.strategy` field, consumed by `legacy-adapter.ts` for legacy↔canonical conversion — that stays).

- [ ] **Step 10: Commit**

```bash
git add -u && git add src/capability/index.ts
git commit -m "refactor(capability): CAP-4 remove legacy strategy-keyed dispatch"
```

---






