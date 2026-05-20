# Tool Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tool security components for capability registry and secret scanning

**Architecture:** CapabilityRegistry maintains tool definitions, SecretScanner detects sensitive data patterns. Both integrate with PolicyEngine for runtime enforcement.

**Tech Stack:** TypeScript, existing src/policy/ modules, pattern matching

---

## Tool Security Components

### Task 1: CapabilityRegistry Enhancement

**Files:**
- Modify: `src/policy/tool-registry.ts` (if exists) or Create: `src/policy/capability-registry.ts`
- Create: `tests/policy/capability-registry.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/policy/capability-registry.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { CapabilityRegistry } from "../../src/policy/capability-registry.js";

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("registers tool capabilities", () => {
    registry.register("file.read", {
      description: "Read file contents",
      riskLevel: "low",
      requiresApproval: false,
      patterns: [".*"],
    });
    
    const capability = registry.get("file.read");
    assert.ok(capability);
    assert.equal(capability.riskLevel, "low");
  });

  it("classifies tools by risk level", () => {
    registry.register("shell.exec", {
      description: "Execute shell commands",
      riskLevel: "critical",
      requiresApproval: true,
    });
    
    const critical = registry.getByRiskLevel("critical");
    assert.ok(critical.some(t => t.name === "shell.exec"));
  });

  it("filters tools by pattern", () => {
    registry.register("git.push", {
      description: "Push to remote",
      riskLevel: "high",
      requiresApproval: true,
    });
    
    const writeOps = registry.filter(cap => cap.riskLevel !== "low");
    assert.ok(writeOps.length >= 1);
  });

  it("provides default capabilities", () => {
    const defaults = registry.getDefaults();
    assert.ok(defaults.length > 0);
    assert.ok(defaults.some(c => c.name === "file.read"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/policy/capability-registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement CapabilityRegistry**

```typescript
// src/policy/capability-registry.ts
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolCapability {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  patterns?: RegExp[];
  category?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface CapabilityRegistryOptions {
  strictMode?: boolean;
  defaultRiskLevel?: RiskLevel;
}

export class CapabilityRegistry {
  private capabilities = new Map<string, ToolCapability>();
  private options: Required<CapabilityRegistryOptions>;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? true,
      defaultRiskLevel: options.defaultRiskLevel ?? "medium",
    };
    this.registerDefaults();
  }

  register(name: string, capability: Omit<ToolCapability, "name">): void {
    this.capabilities.set(name, { ...capability, name });
  }

  get(name: string): ToolCapability | undefined {
    return this.capabilities.get(name);
  }

  getByRiskLevel(level: RiskLevel): ToolCapability[] {
    return [...this.capabilities.values()].filter(c => c.riskLevel === level);
  }

  filter(predicate: (cap: ToolCapability) => boolean): ToolCapability[] {
    return [...this.capabilities.values()].filter(predicate);
  }

  getDefaults(): ToolCapability[] {
    return [...this.capabilities.values()];
  }

  requiresApproval(name: string): boolean {
    const cap = this.get(name);
    return cap?.requiresApproval ?? this.options.strictMode;
  }

  getRiskLevel(name: string): RiskLevel {
    return this.get(name)?.riskLevel ?? this.options.defaultRiskLevel;
  }

  private registerDefaults(): void {
    const defaults: [string, Omit<ToolCapability, "name">][] = [
      ["file.read", { description: "Read file contents", riskLevel: "low", requiresApproval: false, category: "filesystem" }],
      ["file.write", { description: "Write file contents", riskLevel: "medium", requiresApproval: true, category: "filesystem" }],
      ["file.delete", { description: "Delete files", riskLevel: "high", requiresApproval: true, category: "filesystem" }],
      ["shell.exec", { description: "Execute shell commands", riskLevel: "critical", requiresApproval: true, category: "system" }],
      ["shell.read", { description: "Read shell output", riskLevel: "low", requiresApproval: false, category: "system" }],
      ["git.commit", { description: "Create git commits", riskLevel: "medium", requiresApproval: true, category: "vcs" }],
      ["git.push", { description: "Push to remote", riskLevel: "high", requiresApproval: true, category: "vcs" }],
      ["network.request", { description: "Make network requests", riskLevel: "medium", requiresApproval: true, category: "network" }],
    ];
    
    for (const [name, cap] of defaults) {
      this.register(name, cap);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/policy/capability-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/capability-registry.ts tests/policy/capability-registry.test.ts
git commit -m "feat(tool-security): add CapabilityRegistry for tool risk classification"
```

---

### Task 2: SecretScanner

**Files:**
- Create: `src/security/secret-scanner.ts`
- Create: `tests/security/secret-scanner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/security/secret-scanner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { SecretScanner } from "../../src/security/secret-scanner.js";

describe("SecretScanner", () => {
  it("detects API keys", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('const apiKey = "sk-1234567890abcdef"');
    assert.ok(findings.some(f => f.type === "api_key"));
  });

  it("detects AWS credentials", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    assert.ok(findings.some(f => f.type === "aws_key"));
  });

  it("detects private keys", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan("-----BEGIN RSA PRIVATE KEY-----");
    assert.ok(findings.some(f => f.type === "private_key"));
  });

  it("detects passwords in config", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('password: "mysecretpass"');
    assert.ok(findings.some(f => f.type === "password"));
  });

  it("reports location and context", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('DB_PASSWORD="secret123"\nconst db = connect();');
    const finding = findings[0];
    assert.ok(finding.line);
    assert.ok(finding.column);
    assert.ok(finding.context);
  });

  it("sanitizes findings for logging", () => {
    const scanner = new SecretScanner();
    const finding = scanner.scanOne('api_key = "sk-1234567890abcdef"');
    assert.ok(!finding.value.includes("1234567890"));
    assert.equal(finding.value, "sk-1*************def");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/security/secret-scanner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SecretScanner**

```typescript
// src/security/secret-scanner.ts
export type SecretType = 
  | "api_key" 
  | "aws_key" 
  | "aws_secret" 
  | "private_key" 
  | "password" 
  | "token" 
  | "secret" 
  | "bearer_token"
  | "basic_auth";

export interface SecretFinding {
  type: SecretType;
  line: number;
  column: number;
  context: string;
  value: string;
  confidence: "high" | "medium" | "low";
  rule: string;
}

export interface SecretScannerOptions {
  minConfidence?: "high" | "medium" | "low";
  customPatterns?: { type: SecretType; pattern: RegExp; rule: string }[];
  excludePaths?: string[];
}

export class SecretScanner {
  private patterns: { type: SecretType; pattern: RegExp; rule: string }[];

  constructor(options: SecretScannerOptions = {}) {
    this.patterns = [
      { type: "api_key", pattern: /sk-[a-zA-Z0-9]{20,}/g, rule: "OpenAI API key" },
      { type: "api_key", pattern: /AIza[a-zA-Z0-9_-]{35}/g, rule: "Google API key" },
      { type: "aws_key", pattern: /AKIA[0-9A-Z]{16}/g, rule: "AWS Access Key ID" },
      { type: "aws_secret", pattern: /(?i)aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/g, rule: "AWS Secret" },
      { type: "private_key", pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g, rule: "Private key" },
      { type: "password", pattern: /(?i)(password|passwd|pwd)\s*[=:]\s*['"][^'"]+['"]/g, rule: "Password assignment" },
      { type: "token", pattern: /ghp_[a-zA-Z0-9]{36}/g, rule: "GitHub Personal Access Token" },
      { type: "token", pattern: /xox[baprs]-[0-9a-zA-Z]{10,}/g, rule: "Slack Token" },
      { type: "bearer_token", pattern: /(?i)bearer\s+[a-zA-Z0-9_-]{20,}/g, rule: "Bearer token" },
      { type: "basic_auth", pattern: /(?i)authorization\s*:\s*basic\s+[A-Za-z0-9+/=]{20,}/g, rule: "Basic auth" },
      { type: "secret", pattern: /(?i)(secret|api_secret)\s*[=:]\s*['"][A-Za-z0-9_=-]{20,}/g, rule: "Generic secret" },
      ...(options.customPatterns ?? []),
    ];
  }

  scan(content: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      
      for (const { type, pattern, rule } of this.patterns) {
        pattern.lastIndex = 0;
        let match;
        
        while ((match = pattern.exec(line)) !== null) {
          findings.push({
            type,
            line: lineNum + 1,
            column: match.index + 1,
            context: line.trim(),
            value: this.sanitize(match[0]),
            confidence: this.getConfidence(type, match[0]),
            rule,
          });
        }
      }
    }
    
    return findings;
  }

  scanOne(content: string): SecretFinding | null {
    return this.scan(content)[0] ?? null;
  }

  private sanitize(value: string): string {
    if (value.length <= 12) return "*".repeat(value.length);
    return value.slice(0, 4) + "*".repeat(Math.min(value.length - 8, 20)) + value.slice(-3);
  }

  private getConfidence(type: SecretType, value: string): "high" | "medium" | "low" {
    if (type === "private_key") return "high";
    if (type === "aws_key" || type === "api_key") return "high";
    if (value.includes("example") || value.includes("test")) return "low";
    return "medium";
  }

  async scanFile(path: string, readFile: (p: string) => Promise<string>): Promise<SecretFinding[]> {
    const content = await readFile(path);
    return this.scan(content);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/security/secret-scanner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/secret-scanner.ts tests/security/secret-scanner.test.ts
git commit -m "feat(tool-security): add SecretScanner for sensitive data detection"
```

---

### Task 3: PolicyEngine Integration with Tool Security

**Files:**
- Modify: `src/policy/policy-engine.ts` - integrate capability and secret scanning
- Test: `tests/policy/policy-engine-security.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/policy/policy-engine-security.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import { CapabilityRegistry } from "../../src/policy/capability-registry.js";
import { SecretScanner } from "../../src/security/secret-scanner.js";

describe("PolicyEngine Tool Security Integration", () => {
  let policyEngine: PolicyEngine;
  let capabilityRegistry: CapabilityRegistry;
  let secretScanner: SecretScanner;

  beforeEach(() => {
    capabilityRegistry = new CapabilityRegistry();
    secretScanner = new SecretScanner();
    policyEngine = new PolicyEngine(testConfig, {
      capabilityRegistry,
      secretScanner,
    });
  });

  it("blocks shell.exec by default (critical risk)", () => {
    const decision = policyEngine.decide({ toolCallId: "call-1", capability: "shell.exec" });
    assert.equal(decision.decision, "deny");
  });

  it("detects secrets in code before execution", async () => {
    const code = 'const key = "sk-1234567890abcdef"';
    const findings = secretScanner.scan(code);
    assert.ok(findings.length > 0);
  });

  it("uses CapabilityRegistry for risk classification", () => {
    const risk = capabilityRegistry.getRiskLevel("shell.exec");
    assert.equal(risk, "critical");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/policy/policy-engine-security.test.ts`
Expected: FAIL

- [ ] **Step 3: Add integration to PolicyEngine**

```typescript
// Add to policy-engine.ts
private capabilityRegistry?: CapabilityRegistry;
private secretScanner?: SecretScanner;

setCapabilityRegistry(registry: CapabilityRegistry): void {
  this.capabilityRegistry = registry;
}

setSecretScanner(scanner: SecretScanner): void {
  this.secretScanner = scanner;
}

checkWithSecurity(params: CheckParams & { code?: string }): Decision {
  const decision = this.decide(params);
  
  if (decision.decision === "allow" && params.code && this.secretScanner) {
    const findings = this.secretScanner.scan(params.code);
    if (findings.length > 0) {
      return {
        ...decision,
        decision: "deny",
        reason: `Detected ${findings.length} potential secrets in code`,
        metadata: { secretFindings: findings },
      };
    }
  }
  
  return decision;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/policy/policy-engine-security.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/policy-engine.ts tests/policy/policy-engine-security.test.ts
git commit -m "feat(tool-security): integrate CapabilityRegistry and SecretScanner with PolicyEngine"
```

---

## Execution Options

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**