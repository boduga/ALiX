# A5 Outcome Observation & Validation — Design Specification

**Date:** 2026-07-12
**Status:** Draft
**Phase:** A5.1 (Minimum Viable Observation)
**Design Review:** Approved architecture freeze

---

## 1. Motivation

A4 introduced governed execution — the ability to apply approved changes under deterministic control with verifiable evidence. What's missing is the feedback half: **did the executed change actually produce the intended effect?**

Without observation, the pipeline delivers a one-way flow:

```
Proposal → Decision → Execution → Evidence
```

Observation closes this into a cycle:

```
Proposal → Decision → Execution → Observation → Evidence → Governance Feedback
```

---

## 2. Design Principles

1. **A5 is the measurement boundary between ALiX and reality** — it observes the system after execution, not during it.
2. **Providers never mutate the system** — observation is read-only by construction.
3. **Providers never throw** — every execution path returns an `ObservationResult` with a structured status.
4. **Evidence is origin-agnostic** — A5 produces `VerificationEvidence { evidenceClass: "observed" }` in the same format as A2's projected evidence. A3 consumes both without knowing the source.
5. **Observation is separate from interpretation** — the bridge projects measurement outcomes into evidence fields faithfully, without inferring governance conclusions.

---

## 3. Core Types

### 3.1 Observation (definition)

```typescript
/**
 * An observation definition — what to measure and how.
 */
interface Observation {
  /** Unique identifier for this observation. */
  readonly observationId: string;
  /** The provider to dispatch this observation to (deterministic routing key). */
  readonly provider: string;
  /** Human-readable description of what is being measured. */
  readonly description: string;
  /** Optional expected value for verification-style observations. */
  readonly expected?: unknown;
  /** Provider-specific configuration parameters. */
  readonly params?: Record<string, unknown>;
}
```

- `provider` is the deterministic routing key — the engine looks up the provider by name, never scans
- `expected` is optional — reality-capture observations have no expectation, only a measurement
- `params` carries provider-specific configuration (e.g. `{ command: "alix status" }`)

### 3.2 ObservationResult

```typescript
type ObservationStatus = "pass" | "fail" | "error" | "inconclusive";

interface ObservationResult {
  /** Matches the originating Observation.observationId. */
  readonly observationId: string;
  /** Outcome of this observation measurement. */
  readonly status: ObservationStatus;
  /** Confidence in THIS measurement (0-1), not a provider-level reliability score. */
  readonly confidence: number;
  /** When the measurement was taken. */
  readonly observedAt: string;
  /** The expected value (copied from Observation if provided). */
  readonly expected?: unknown;
  /** The observed value (may be absent on error/inconclusive). */
  readonly observed?: unknown;
  /** Provider-specific raw evidence artifacts. */
  readonly evidence: Record<string, unknown>;
}
```

#### Status semantics

| Status | Meaning | Example |
|--------|---------|---------|
| `pass` | Measured outcome matches expectation | `expected: 0, observed: 0` |
| `fail` | Measured outcome contradicts expectation | `expected: 0, observed: 1` |
| `error` | Observation could not be completed | Command not found, timeout, provider bug |
| `inconclusive` | Measurement unreliable | Detached HEAD, truncated output |

#### Error discrimination

The `evidence` field must distinguish error sources:

```typescript
// Provider runtime bug
{ errorType: "provider_exception", message: "Cannot read property 'x' of undefined" }

// Environment failure
{ errorType: "environment_failure", message: "git executable unavailable" }

// Timeout
{ errorType: "timeout", duration: 30000, limit: 10000 }
```

This enables future learning systems to cluster failures by root cause.

### 3.3 ObservationProvider

```typescript
interface ObservationProvider {
  /** Unique provider name (used as the Observation.provider routing key). */
  readonly name: string;
  /** Descriptive capability tags for discovery/diagnostics. */
  readonly capabilities: readonly string[];
  /** Optional validation guard — not runtime dispatch. */
  canObserve?(observation: Observation): boolean;
  /** Execute the observation. MUST return a result, never throw. */
  observe(observation: Observation): Promise<ObservationResult>;
}
```

- `canObserve()` is a validation hook for startup checks and test assertions — not for runtime routing
- `observe()` must catch all internal exceptions and return them as `{ status: "error" }` results
- The engine wraps `observe()` calls in a try/catch as a final safety net

---

## 4. Observation Engine

### 4.1 Engine API

```typescript
class ObservationEngine {
  register(provider: ObservationProvider): void;
  observe(observation: Observation): Promise<ObservationResult>;
  observeAll(observations: Observation[]): Promise<ObservationResult[]>;
  getProvider(name: string): ObservationProvider | undefined;
}
```

### 4.2 Registration

```typescript
register(provider: ObservationProvider): void {
  if (this.providers.has(provider.name)) {
    throw new Error(`Provider already registered: ${provider.name}`);
  }
  this.providers.set(provider.name, provider);
}
```

Duplicate provider registration is a **configuration-time failure**, not an observation-time error. This catches misconfiguration during construction.

### 4.3 Dispatch

```typescript
async observe(observation: Observation): Promise<ObservationResult> {
  const provider = this.providers.get(observation.provider);
  if (!provider) {
    return {
      observationId: observation.observationId,
      status: "error",
      confidence: 0,
      observedAt: new Date().toISOString(),
      evidence: { errorType: "environment_failure", message: `Unknown provider: ${observation.provider}` },
    };
  }
  try {
    return await provider.observe(observation);
  } catch (err) {
    return {
      observationId: observation.observationId,
      status: "error",
      confidence: 0,
      observedAt: new Date().toISOString(),
      evidence: { errorType: "provider_exception", message: String(err) },
    };
  }
}
```

### 4.4 Batch Observation

```typescript
async observeAll(observations: Observation[]): Promise<ObservationResult[]> {
  const concurrency = this.config.maxConcurrency ?? 4;
  const results: (ObservationResult | null)[] = new Array(observations.length);
  const running = new Set<number>();

  for (let i = 0; i < observations.length; i++) {
    // ... bounded concurrency loop ...
    // Results are inserted at index i to preserve input ordering
  }

  return results.filter((r): r is ObservationResult => r !== null);
}
```

**Critical invariant:** result ordering matches input ordering. This is required for deterministic evidence hashing.

---

## 5. Observation Providers (V1)

### 5.1 CLI Provider

```typescript
name: "cli"
capabilities: ["cli"]

observe(observation): Promise<ObservationResult>
```

- Runs a shell command via `child_process.execFile` (no shell expansion)
- Captures: exit code, stdout, stderr, duration
- Default confidence: 1.0
- Downgrades confidence on:
  - Timeout (`confidence *= 0.5`)
  - Truncated output (`confidence *= 0.8`)
  - stderr content present (`confidence *= 0.9`)

### 5.2 Filesystem Provider

```typescript
name: "filesystem"
capabilities: ["filesystem"]

observe(observation): Promise<ObservationResult>
```

- Can check: file exists, hash (SHA-256), content match, stat info
- Configuration via `observation.params`: `{ path, check: "exists" | "hash" | "content" | "stat" }`

### 5.3 Git Provider

```typescript
name: "git"
capabilities: ["git"]

observe(observation): Promise<ObservationResult>
```

- Can check: branch name, diff stats, file listing, commit count
- Configuration via `observation.params`: `{ check: "branch" | "diff" | "files" | "clean" }`
- Downgrades confidence on: shallow clone (0.95), detached HEAD (0.75), corrupted objects (0.4)

### 5.4 Ledger Provider

```typescript
name: "ledger"
capabilities: ["ledger"]

observe(observation): Promise<ObservationResult>
```

- Checks governance evidence ledger for expected records
- Configuration via `observation.params`: `{ check: "has_evidence" | "evidence_count" | "last_evidence" }`

---

## 6. Evidence Bridge

### 6.1 Bridge Function

```typescript
function buildObservationEvidence(
  input: ObservationBuildInput,
): VerificationEvidence
```

Where:

```typescript
interface ObservationBuildInput {
  proposalId: string;
  evolutionId: string;
  environmentHash: string;
  observations: ObservationResult[];
}
```

### 6.2 Mapping Rules

- `evidenceClass`: always `"observed"`
- `baselineMetrics`: computed from observation results (pass count, fail count, mean confidence)
- `candidateMetrics`: empty (observation is not a counterfactual comparison)
- `metricDeltas`: pass/fail ratios
- `behavioralChanges`: **faithful projections** of observation outcomes:

  ```
  ✅ "CLI command 'alix status' exited with code 0"
  ❌ Never: "system is stable" (governance interpretation)
  ```

- `confidenceProfile`: aggregate of observation confidences (mean, min, decay factor)
- `reproducibilityLevel`: always 0 (observations are not reproducibility tests)
- `lineage`: links observation results back to the execution evidence

### 6.3 Integrity

- Integrity hash computed via the same `canonicalStringify + SHA-256` contract as A2/A4
- Transient fields: none (all observation results are part of the evidence identity)

---

## 7. CLI Integration

### 7.1 Command

```bash
alix evolution observe <evolution-id>

alix evolution observe <evolution-id> --reevaluate
alix evolution observe <evolution-id> --json
```

- `--reevaluate` (optional): after building evidence, trigger A3 re-evaluation with the new observed evidence
- `--json`: output raw JSON instead of terminal format

### 7.2 Flow

1. Resolve evolution by ID
2. Build v1 observation set (one per registered provider, hardcoded for A5.1)
3. Dispatch to `ObservationEngine.observeAll()`
4. Aggregate results into `VerificationEvidence` via bridge
5. Store evidence in ledger
6. If `--reevaluate`, run `alix governance evolution decide <id>`
7. Output result

### 7.3 Safety

Observation is safe and repeatable — it never triggers governance decisions without explicit `--reevaluate`. This ensures users can run `alix evolution observe` freely to inspect system state without surprising state transitions.

---

## 8. Error Handling Summary

| Scenario | Handling | Result Status |
|----------|----------|---------------|
| Provider not registered | Engine returns error result | `error` |
| Provider throws (bug) | Engine catches, wraps | `error` |
| Command not found | Provider catches, returns error | `error` |
| Provider timeout | Provider returns error with timeout evidence | `error` |
| Measurement matches expectation | Normal return | `pass` |
| Measurement contradicts expectation | Normal return | `fail` |
| Measurement unreliable | Provider downgrades confidence | `inconclusive` |
| Duplicate provider registration | Engine throws at config time | N/A (crash) |

---

## 9. V1 Scope (A5.1)

### In scope

| Component | Files |
|-----------|-------|
| Core types | `src/evolution/observation/contracts/observation-contract.ts` |
| ObservationEngine | `src/evolution/observation/observation-engine.ts` |
| CLI Provider | `src/evolution/observation/providers/cli-provider.ts` |
| Filesystem Provider | `src/evolution/observation/providers/filesystem-provider.ts` |
| Git Provider | `src/evolution/observation/providers/git-provider.ts` |
| Ledger Provider | `src/evolution/observation/providers/ledger-provider.ts` |
| Evidence bridge | `src/evolution/observation/observation-evidence-bridge.ts` |
| CLI handler | `src/evolution/observation/observation-cli.ts` |
| Barrel exports | `src/evolution/observation/index.ts` |
| Tests | `tests/evolution/observation/` |

### Out of scope (A5.2+)

- Capability-based provider matching
- Observation scheduling / deferred observation
- Dedicated Test Provider
- Remote/deployment providers
- Observation templates

---

## 10. A-Series Pipeline (Final State)

```
A0 Evolution Contract ──────────────────────────┐
      │                                           │
      ▼                                           │
A1 Pattern Discovery                              │
      │                                           │
      ▼                                           │
A2 Evolution Verification                         │
  ┌─ Projected Evidence ────┐                     │
  │                         │                     │
  ▼                         ▼                     │
A3 Governance Decision ──── Decide ───────────────┤
      │                                           │
      ▼                                           │
A4 Governed Execution                             │
  └─ Executed Evidence ───┐                       │
                          │                       │
                          ▼                       ▼
A5 Outcome Observation ── Observed Evidence ──► Governance Feedback
```

---

## 11. Spec Self-Review

### Placeholder scan
- No TODOs or TBDs remaining
- All interfaces fully specified
- No "future work" markers inside v1 types

### Internal consistency
- `Observation.provider` routes deterministically — consistent with `ObservationEngine.observe()`
- `ObservationResult.status` covers all outcomes — consistent with error handling table
- `buildObservationEvidence()` produces `VerificationEvidence` — consistent with A2 contract
- CLI `--reevaluate` is optional — consistent with safe-by-default principle

### Scope check
- A5.1 is focused on a single concern: post-execution observation
- Provider set is primitive (CLI, filesystem, git, ledger) — no exotic providers
- Test Provider explicitly deferred to A5.2

### Ambiguity check
- Error discrimination: `errorType` field distinguishes provider_exception vs environment_failure — unambiguous
- Confidence: explicitly documented as measurement confidence, not proposal success confidence
- Behavioral changes: bridge maps faithfully, does not reinterpret — unambiguous
