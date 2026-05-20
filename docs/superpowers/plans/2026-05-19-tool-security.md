# Tool Security Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the PolicyEngine with CommandClassifier and NetworkPolicyMatcher components.

**Architecture:** Build on existing PolicyEngine in `src/policy/`. CommandClassifier analyzes shell commands for risk, NetworkPolicyMatcher validates network destinations against allow/deny rules.

**Tech Stack:** TypeScript, existing policy infrastructure, node:net for network utilities

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/policy/command-classifier.ts` | Classify shell commands by risk type and extract metadata |
| `src/policy/network-policy-matcher.ts` | Match network requests against domain/IP allowlists and blocklists |
| `tests/policy/command-classifier.test.ts` | Command classification tests |
| `tests/policy/network-policy-matcher.test.ts` | Network policy matching tests |

---

## Task 1: Add CommandClassifier

**Files:**
- Create: `src/policy/command-classifier.ts`
- Test: `tests/policy/command-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandClassifier, type CommandRisk } from "../../src/policy/command-classifier.js";

describe("CommandClassifier", () => {
  const classifier = new CommandClassifier();

  it("classifies safe read-only commands", () => {
    const result = classifier.classify("cat src/index.ts");
    assert.equal(result.risk, "low");
    assert.ok(result.safe);
  });

  it("classifies git commands", () => {
    const result = classifier.classify("git status");
    assert.equal(result.risk, "medium");
    assert.ok(!result.safe);
  });

  it("classifies destructive commands", () => {
    const result = classifier.classify("rm -rf node_modules");
    assert.equal(result.risk, "high");
    assert.ok(!result.safe);
    assert.deepEqual(result.tags, ["destructive", "file-modification"]);
  });

  it("extracts file paths from commands", () => {
    const result = classifier.classify("git add src/*.ts");
    assert.ok(result.paths.some(p => p.includes("src")));
  });

  it("classifies network commands", () => {
    const result = classifier.classify("curl https://api.example.com");
    assert.ok(result.networkDestination);
    assert.equal(result.networkDestination, "api.example.com");
  });

  it("classifies npm/yarn commands", () => {
    const result = classifier.classify("npm install");
    assert.equal(result.risk, "medium");
    assert.ok(result.tags.includes("dependency"));
  });

  it("classifies shell operators", () => {
    const result = classifier.classify("echo 'hi' && ls");
    assert.ok(result.hasChain);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/policy/command-classifier.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement CommandClassifier**

```typescript
// src/policy/command-classifier.ts

export type CommandRisk = "low" | "medium" | "high" | "critical";

export type CommandClassification = {
  original: string;
  risk: CommandRisk;
  safe: boolean;
  category: string;
  tags: string[];
  paths: string[];
  networkDestination?: string;
  hasChain: boolean;
  environment?: string[];
};

type RiskRule = {
  pattern: RegExp;
  risk: CommandRisk;
  category: string;
  tags: string[];
};

export class CommandClassifier {
  private rules: RiskRule[] = [
    // Read-only commands (low risk)
    { pattern: /^(cat|head|tail|grep|rg|find|ls|stat|wc)\s/, risk: "low", category: "read", tags: ["read-only"] },
    { pattern: /^echo\s/, risk: "low", category: "echo", tags: ["read-only"] },

    // Git commands (medium risk)
    { pattern: /^git\s+(status|stash|log|show|diff|branch)/, risk: "medium", category: "git-read", tags: ["git", "read-only"] },
    { pattern: /^git\s+(add|commit|push|pull|fetch)/, risk: "medium", category: "git-mutate", tags: ["git", "mutation"] },

    // Package managers (medium risk)
    { pattern: /^(npm|yarn|pnpm|bun)\s+(install|add)/, risk: "medium", category: "dependency", tags: ["dependency"] },
    { pattern: /^(npm|yarn|pnpm)\s+(run|exec)/, risk: "medium", category: "script", tags: ["script"] },
    { pattern: /^(npm|yarn|pnpm)\s+remove|uninstall/, risk: "medium", category: "dependency-remove", tags: ["dependency", "mutation"] },

    // Network commands (detect network destination)
    { pattern: /^(curl|wget|http|python.*requests|fetch)\s+https?:\/\/([^/\s]+)/, risk: "medium", category: "network", tags: ["network"], extractNetwork: true },

    // Build/test (medium risk)
    { pattern: /^(npm|yarn|pnpm)\s+(test|build|lint|check|typecheck)/, risk: "medium", category: "build", tags: ["build"] },
    { pattern: /^(make|cmake|go|gradle|mvn|ant)\s+(build|test|compile)/, risk: "medium", category: "build", tags: ["build"] },

    // Destructive file operations (high risk)
    { pattern: /^rm\s+-rf/, risk: "high", category: "destroy", tags: ["destructive", "file-modification"] },
    { pattern: /^dd\s+/, risk: "high", category: "destroy", tags: ["destructive", "block-device"] },
    { pattern: /^mkfs|formatt/, risk: "high", category: "destroy", tags: ["destructive", "filesystem"] },

    // System modification (high risk)
    { pattern: /^sudo\s+(rm|chmod|chown|passwd|useradd)/, risk: "high", category: "system", tags: ["sudo", "system-modification"] },
    { pattern: /^\s*>\s*\/(etc|usr|var)/, risk: "high", category: "system", tags: ["redirect", "system-path"] },

    // Shell operators indicate chaining
    { pattern: /(&&|\|\||;|\||\(|\`|\$\()/, risk: "low", category: "shell", tags: ["chaining"], hasChain: true },
  ];

  private urlPattern = /https?:\/\/([^/\s]+)/;

  classify(command: string): CommandClassification {
    const trimmed = command.trim();
    let risk: CommandRisk = "low";
    let category = "unknown";
    const tags: string[] = [];
    let networkDestination: string | undefined;
    let hasChain = false;
    const paths: string[] = [];
    const environment: string[] = [];

    // Check for environment variable assignments
    const envMatches = trimmed.match(/\b([A-Z_][A-Z0-9_]*)=/g);
    if (envMatches) {
      environment.push(...envMatches);
      tags.push("environment-set");
    }

    // Check for environment variable usage
    if (/\$[A-Z_][A-Z0-9_]*/.test(trimmed)) {
      tags.push("env-usage");
    }

    // Apply rules
    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        risk = rule.risk;
        category = rule.category;
        tags.push(...rule.tags);
        hasChain = (rule as any).hasChain || /\s(&&|\|\||;)\s/.test(trimmed);
        if ((rule as any).extractNetwork) {
          const match = trimmed.match(this.urlPattern);
          if (match) networkDestination = match[1];
        }
        break;
      }
    }

    // Extract file paths (heuristic: quoted strings and path patterns)
    const quotedMatches = trimmed.match(/'([^']+)'|"([^"]+)"/g) || [];
    for (const match of quotedMatches) {
      const path = match.slice(1, -1);
      if (path.includes("/") || path.includes(".")) {
        paths.push(path);
      }
    }

    // Extract path arguments (src/, lib/, ./, ../)
    const pathMatches = trimmed.match(/(?:^|\s)(?:(?:\.\.?|src|lib|tests?|dist|build|out|node_modules|\.git|\.env)[^\s]*)/g) || [];
    for (const match of pathMatches) {
      const path = match.trim();
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
    }

    // Check for network destination in curl/wget
    const networkMatch = trimmed.match(/(?:curl|wget|fetch|http)\s+(?:--)?(?:url=)?'?https?:\/\/([^/'\s]+)/i);
    if (networkMatch) {
      networkDestination = networkMatch[1];
    }

    return {
      original: trimmed,
      risk,
      safe: risk === "low",
      category,
      tags,
      paths: [...new Set(paths)],
      networkDestination,
      hasChain,
      environment: environment.length > 0 ? environment : undefined,
    };
  }

  getRiskLevel(command: string): CommandRisk {
    return this.classify(command).risk;
  }

  getNetworkDestination(command: string): string | undefined {
    return this.classify(command).networkDestination;
  }
}

export function classifyCommand(command: string): CommandClassification {
  return new CommandClassifier().classify(command);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/policy/command-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/command-classifier.ts tests/policy/command-classifier.test.ts
git commit -m "feat(policy): add CommandClassifier for shell command risk analysis"
```

---

## Task 2: Add NetworkPolicyMatcher

**Files:**
- Create: `src/policy/network-policy-matcher.ts`
- Test: `tests/policy/network-policy-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { NetworkPolicyMatcher, type NetworkPolicy } from "../../src/policy/network-policy-matcher.js";

describe("NetworkPolicyMatcher", () => {
  const policy: NetworkPolicy = {
    defaultAction: "ask",
    allowlist: ["api.stripe.com", "api.github.com", "localhost", "127.0.0.1"],
    blocklist: ["evil.example.com", "malware.net"],
    allowedPorts: [80, 443, 8080, 8443],
  };

  const matcher = new NetworkPolicyMatcher(policy);

  it("allows allowed domains", () => {
    const result = matcher.match("api.stripe.com");
    assert.equal(result.decision, "allow");
  });

  it("blocks blocklisted domains", () => {
    const result = matcher.match("evil.example.com");
    assert.equal(result.decision, "deny");
  });

  it("asks for unknown domains", () => {
    const result = matcher.match("unknown-api.example.com");
    assert.equal(result.decision, "ask");
  });

  it("extracts domain from URLs", () => {
    const result = matcher.match("https://api.github.com/users");
    assert.equal(result.decision, "allow");
  });

  it("includes port in match", () => {
    const result = matcher.match("example.com:8080");
    assert.equal(result.matched, "example.com");
    assert.equal(result.port, 8080);
  });

  it("validates port against allowed list", () => {
    const result = matcher.match("example.com:22");
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "port_not_allowed");
  });

  it("handles IP addresses", () => {
    const result = matcher.match("127.0.0.1");
    assert.equal(result.decision, "allow");
  });

  it("returns CIDR subnet support", () => {
    const result = matcher.match("192.168.1.100");
    assert.ok(result);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/policy/network-policy-matcher.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement NetworkPolicyMatcher**

```typescript
// src/policy/network-policy-matcher.ts

export type NetworkDecision = "allow" | "ask" | "deny";

export type NetworkPolicy = {
  defaultAction: NetworkDecision;
  allowlist: string[];
  blocklist: string[];
  allowedPorts?: number[];
  allowedCIDRs?: string[];
};

export type NetworkMatchResult = {
  domain: string;
  decision: NetworkDecision;
  reason: string;
  matched?: string;
  port?: number;
};

function parseHostPort(target: string): { host: string; port?: number } {
  // Handle URLs like https://example.com:8080/path
  const urlMatch = target.match(/^https?:\/\/([^/:]+)(?::(\d+))?(?:\/|$)/i);
  if (urlMatch) {
    return { host: urlMatch[1], port: urlMatch[2] ? parseInt(urlMatch[2], 10) : undefined };
  }

  // Handle host:port like example.com:8080
  const portMatch = target.match(/^([^:]+):(\d+)$/);
  if (portMatch) {
    return { host: portMatch[1], port: parseInt(portMatch[2], 10) };
  }

  return { host: target };
}

function isCIDRMatch(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const maskBits = bits ? parseInt(bits, 10) : 32;

  const ipParts = ip.split(".").map(Number);
  const rangeParts = range.split(".").map(Number);

  const mask = (0xffffffff << (32 - maskBits)) >>> 0;
  const ipNum = (ipParts.reduce((acc, p) => (acc << 8) | p, 0)) >>> 0;
  const rangeNum = (rangeParts.reduce((acc, p) => (acc << 8) | p, 0)) >>> 0;

  return (ipNum & mask) === (rangeNum & mask);
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}

function domainMatches(target: string, pattern: string): boolean {
  const normalizedTarget = normalizeDomain(target);
  const normalizedPattern = normalizeDomain(pattern);

  // Exact match
  if (normalizedTarget === normalizedPattern) return true;

  // Subdomain match (api.github.com matches github.com)
  if (normalizedTarget.endsWith("." + normalizedPattern)) return true;

  // Wildcard patterns
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedTarget.endsWith(suffix) || normalizedTarget === suffix.slice(1);
  }

  return false;
}

export class NetworkPolicyMatcher {
  constructor(private policy: NetworkPolicy) {}

  match(target: string): NetworkMatchResult {
    const { host, port } = parseHostPort(target);
    const normalizedHost = normalizeDomain(host);

    // Check blocklist first (explicit deny)
    for (const blocked of this.policy.blocklist) {
      if (domainMatches(normalizedHost, blocked)) {
        return {
          domain: normalizedHost,
          decision: "deny",
          reason: "blocklist",
          matched: blocked,
          port,
        };
      }
    }

    // Check allowlist (explicit allow)
    for (const allowed of this.policy.allowlist) {
      if (domainMatches(normalizedHost, allowed)) {
        return {
          domain: normalizedHost,
          decision: "allow",
          reason: "allowlist",
          matched: allowed,
          port,
        };
      }
    }

    // Check CIDR allowlist for IP addresses
    if (this.policy.allowedCIDRs && /^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) {
      for (const cidr of this.policy.allowedCIDRs) {
        if (isCIDRMatch(normalizedHost, cidr)) {
          return {
            domain: normalizedHost,
            decision: "allow",
            reason: "cidr_allowlist",
            matched: cidr,
            port,
          };
        }
      }
    }

    // Check port restrictions
    if (port !== undefined && this.policy.allowedPorts) {
      if (!this.policy.allowedPorts.includes(port)) {
        return {
          domain: normalizedHost,
          decision: "deny",
          reason: "port_not_allowed",
          matched: normalizedHost,
          port,
        };
      }
    }

    // Default to policy default
    return {
      domain: normalizedHost,
      decision: this.policy.defaultAction,
      reason: "default",
      port,
    };
  }

  isAllowed(target: string): boolean {
    return this.match(target).decision === "allow";
  }

  isDenied(target: string): boolean {
    return this.match(target).decision === "deny";
  }

  requiresApproval(target: string): boolean {
    return this.match(target).decision === "ask";
  }
}

export function matchNetwork(target: string, policy: NetworkPolicy): NetworkMatchResult {
  return new NetworkPolicyMatcher(policy).match(target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/policy/network-policy-matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/network-policy-matcher.ts tests/policy/network-policy-matcher.test.ts
git commit -m "feat(policy): add NetworkPolicyMatcher for network destination validation"
```

---

## Task 3: Integrate with PolicyEngine

**Files:**
- Modify: `src/policy/policy-engine.ts`

- [ ] **Step 1: Read current PolicyEngine**

Run: `cat src/policy/policy-engine.ts | head -50`
Expected: Show PolicyEngine class structure

- [ ] **Step 2: Add integration test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import { CommandClassifier } from "../../src/policy/command-classifier.js";
import { NetworkPolicyMatcher } from "../../src/policy/network-policy-matcher.js";

describe("PolicyEngine integration", () => {
  it("uses CommandClassifier for shell commands", async () => {
    const engine = new PolicyEngine({
      defaultMode: "ask",
    });
    const classifier = new CommandClassifier();
    engine.setCommandClassifier(classifier);

    const result = engine.check({
      toolCallId: "test-1",
      toolName: "shell.run",
      args: { command: "cat src/index.ts" },
      capability: "shell.readonly",
      sessionMode: "ask",
    });

    assert.equal(result.decision, "allow");
  });

  it("uses NetworkPolicyMatcher for network commands", async () => {
    const engine = new PolicyEngine({
      defaultMode: "ask",
    });
    engine.setNetworkPolicy({
      defaultAction: "ask",
      allowlist: ["api.github.com"],
      blocklist: [],
    });

    const result = engine.check({
      toolCallId: "test-2",
      toolName: "network.fetch",
      args: { url: "https://api.github.com/users" },
      capability: "network.fetch",
      sessionMode: "ask",
    });

    assert.equal(result.decision, "allow");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/policy/policy-engine.test.ts`
Expected: FAIL (methods don't exist yet)

- [ ] **Step 4: Add methods to PolicyEngine**

Add these methods to PolicyEngine class:

```typescript
// Add to src/policy/policy-engine.ts

private commandClassifier?: CommandClassifier;
private networkMatcher?: NetworkPolicyMatcher;

setCommandClassifier(classifier: CommandClassifier): void {
  this.commandClassifier = classifier;
}

setNetworkPolicy(policy: NetworkPolicy): void {
  this.networkMatcher = new NetworkPolicyMatcher(policy);
}

// In the check() method, add after existing checks:

// Check shell command risk
if (toolName === "shell.run" && this.commandClassifier) {
  const command = (args as { command?: string }).command;
  if (command) {
    const classification = this.commandClassifier.classify(command);
    if (classification.risk === "critical") {
      return {
        toolCallId,
        capability: capability as Capability,
        decision: "deny",
        reason: `Critical risk command: ${classification.category}`,
      };
    }
  }
}

// Check network destination
if (toolName === "network.fetch" && this.networkMatcher) {
  const url = (args as { url?: string }).url;
  if (url) {
    const match = this.networkMatcher.match(url);
    if (match.decision === "deny") {
      return {
        toolCallId,
        capability: capability as Capability,
        decision: "deny",
        reason: `Network destination denied: ${match.reason}`,
      };
    }
    if (match.decision === "ask") {
      return {
        toolCallId,
        capability: capability as Capability,
        decision: "ask",
        reason: `Network destination requires approval: ${match.domain}`,
      };
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/policy/policy-engine.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/policy/policy-engine.ts tests/policy/policy-engine.test.ts
git commit -m "feat(policy): integrate CommandClassifier and NetworkPolicyMatcher"
```

---

## Verification

```bash
npm test -- tests/policy/command-classifier.test.ts tests/policy/network-policy-matcher.test.ts tests/policy/policy-engine.test.ts
```

All tests should pass.