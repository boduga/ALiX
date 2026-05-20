# PolicyEngine Constructor Injection Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PolicyEngine setter-based dependency injection with constructor injection. Fail-fast if a required subsystem is missing.

**Architecture:** `PolicyEngine` constructor takes all subsystems as required arguments. Setters are removed. `check()` and `decide()` remove null-checks — they use the injected subsystems directly. A `PolicyEngineBuilder` provides ergonomics for partial wiring.

**Tech Stack:** TypeScript, node:test, existing policy test fixtures.

---

### Task 1: Add PolicyEngineBuilder

**Files:**
- Modify: `src/policy/policy-engine.ts`
- Test: `tests/policy/policy-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("PolicyEngineBuilder creates engine with all deps", () => {
  const builder = new PolicyEngineBuilder(testConfig);
  builder.withCapabilityRegistry(new CapabilityRegistry());
  builder.withCommandClassifier(new CommandClassifier());
  const engine = builder.build();
  assert.ok(engine);
  assert.equal(typeof engine.check, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/policy/policy-engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Write PolicyEngineBuilder**

```typescript
export class PolicyEngineBuilder {
  constructor(private config: AlixConfig) {}

  withCapabilityRegistry(registry: CapabilityRegistry): this {
    this._capabilityRegistry = registry;
    return this;
  }

  withCommandClassifier(classifier: CommandClassifier): this {
    this._commandClassifier = classifier;
    return this;
  }

  withNetworkPolicy(policy: NetworkPolicy): this {
    this._networkPolicy = new NetworkPolicyMatcher(policy);
    return this;
  }

  withSecretScanner(scanner: SecretScanner): this {
    this._secretScanner = scanner;
    return this;
  }

  withEventLog(log: EventLog, sessionId: string): this {
    this._eventLog = log;
    this._sessionId = sessionId;
    return this;
  }

  build(): PolicyEngine {
    return new PolicyEngine(this.config, {
      capabilityRegistry: this._capabilityRegistry ?? new CapabilityRegistry(),
      commandClassifier: this._commandClassifier,
      networkMatcher: this._networkPolicy,
      secretScanner: this._secretScanner,
      eventLog: this._eventLog,
      sessionId: this._sessionId,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/policy/policy-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/policy-engine.ts tests/policy/policy-engine.test.ts
git commit -m "feat(policy-engine): add PolicyEngineBuilder"
```

---

### Task 2: Convert Setters to Constructor Args

**Files:**
- Modify: `src/policy/policy-engine.ts`
- Test: `tests/policy/policy-engine.test.ts`

- [ ] **Step 1: Update constructor signature**

```typescript
export type PolicyEngineSubsystems = {
  capabilityRegistry?: CapabilityRegistry;
  commandClassifier?: CommandClassifier;
  networkMatcher?: NetworkPolicyMatcher;
  secretScanner?: SecretScanner;
};

export class PolicyEngine {
  constructor(
    private config: AlixConfig,
    private subsystems: PolicyEngineSubsystems = {},
    private options: PolicyEngineOptions = {}
  ) {}
}
```

Remove all `set*` methods. Replace `this.capabilityRegistry?.` with `this.subsystems.capabilityRegistry?.` throughout.

- [ ] **Step 2: Update check() method**

Remove all null-checks on subsystem access. If a subsystem was not provided at construction, its check path is skipped (same as current behavior, but explicit):

```typescript
// Before:
if (this.capabilityRegistry?.requiresApproval(capability)) { ... }

// After:
if (this.subsystems.capabilityRegistry?.requiresApproval(capability)) { ... }
```

- [ ] **Step 3: Update decide() event emission**

Pass subsystems to evaluatePolicy (or access via this.subsystems directly).

- [ ] **Step 4: Run tests**

Run: `node --test tests/policy/policy-engine.test.ts 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/policy/policy-engine.ts tests/policy/policy-engine.test.ts
git commit -m "refactor(policy-engine): use constructor injection, remove setters"
```

---

### Task 3: Update run.ts to Use Builder

**Files:**
- Modify: `src/run.ts`
- Test: None (integration-test territory)

- [ ] **Step 1: Find PolicyEngine construction in run.ts**

```bash
grep -n "new PolicyEngine" src/run.ts
```

- [ ] **Step 2: Replace with builder pattern**

```typescript
const engine = new PolicyEngineBuilder(config)
  .withCapabilityRegistry(capabilityRegistry)
  .withCommandClassifier(commandClassifier)
  .withNetworkPolicy(config.permissions.allowNetworkDomains)
  .withSecretScanner(new SecretScanner())
  .withEventLog(eventLog, sessionId)
  .build();
```

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "refactor(run.ts): use PolicyEngineBuilder"
```