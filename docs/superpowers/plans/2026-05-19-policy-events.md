# Event Schema Alignment: Policy Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement policy events per event-kernel-schema.md: `policy.decision`, `approval.requested`, `approval.resolved`. These enable audit trails for security decisions and approval queue visibility.

**Architecture:** Add EventLog to PolicyEngine. Emit events on every decision. Approval flow emits request/resolved events.

**Tech Stack:** TypeScript, PolicyEngine, EventLog, readline for approvals

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/events/types.ts` | Add policy event payload types |
| `src/policy/policy-engine.ts` | Emit policy.decision events |
| `src/policy/approvals.ts` | Emit approval request/resolved events |
| `src/run.ts` | Wire EventLog into policy components |
| `tests/policy/policy-events.test.ts` | Policy event emission tests |

---

## Task 1: Add Policy Event Payload Types

**Files:**
- Modify: `src/events/types.ts`
- Test: `tests/events/policy-events.test.ts`

- [ ] **Step 1: Add policy event payload types**

Add to `src/events/types.ts`:

```typescript
export type PolicyDecisionPayload = {
  toolCallId: string;
  capability: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRuleId?: string;
};

export type ApprovalRequestedPayload = {
  approvalId: string;
  toolCallId?: string;
  patchProposalId?: string;
  prompt: string;
  choices: Array<"approve" | "deny" | "edit">;
};

export type ApprovalResolvedPayload = {
  approvalId: string;
  decision: "approved" | "denied" | "edited";
  reason?: string;
};

export const POLICY_EVENT_TYPES = {
  DECISION: "policy.decision",
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_RESOLVED: "approval.resolved",
} as const;
```

- [ ] **Step 2: Write tests for policy payload types**

Create `tests/events/policy-events.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  PolicyDecisionPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "../../src/events/types.js";

describe("Policy Event Payload Types", () => {
  it("PolicyDecisionPayload tracks security decisions", () => {
    const payload: PolicyDecisionPayload = {
      toolCallId: "call-123",
      capability: "file.write",
      decision: "ask",
      reason: "Matched tool policy for file.write (mode: ask)",
      matchedRuleId: "file.write-policy",
    };
    assert.equal(payload.decision, "ask");
    assert.ok(payload.reason.includes("file.write"));
  });

  it("PolicyDecisionPayload captures denied decisions", () => {
    const payload: PolicyDecisionPayload = {
      toolCallId: "call-456",
      capability: "file.read",
      decision: "deny",
      reason: "Path is protected: .env",
    };
    assert.equal(payload.decision, "deny");
    assert.ok(payload.reason.includes("protected"));
  });

  it("ApprovalRequestedPayload includes prompt and choices", () => {
    const payload: ApprovalRequestedPayload = {
      approvalId: "approval-789",
      toolCallId: "call-123",
      prompt: "Allow writing to src/index.ts?",
      choices: ["approve", "deny", "edit"],
    };
    assert.equal(payload.choices.length, 3);
    assert.ok(payload.prompt.includes("Allow"));
  });

  it("ApprovalResolvedPayload tracks resolution", () => {
    const payload: ApprovalResolvedPayload = {
      approvalId: "approval-789",
      decision: "approved",
      reason: "User approved",
    };
    assert.equal(payload.decision, "approved");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/events/policy-events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts tests/events/policy-events.test.ts
git commit -m "feat(events): add policy event payload types"
```

---

## Task 2: Add Event Emission to PolicyEngine

**Files:**
- Modify: `src/policy/policy-engine.ts`
- Test: `tests/policy/policy-engine-events.test.ts`

- [ ] **Step 1: Update PolicyEngine to accept EventLog**

Modify `src/policy/policy-engine.ts`:

```typescript
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { PolicyDecisionPayload } from "../events/types.js";

export type PolicyEngineOptions = {
  eventLog?: EventLog;
  sessionId?: string;
};

export class PolicyEngine {
  constructor(
    private config: AlixConfig,
    private options: PolicyEngineOptions = {}
  ) {}

  decide(request: ToolRequest): PolicyDecision {
    const decision = this.evaluatePolicy(request);

    // Emit policy.decision event
    if (this.options.eventLog && this.options.sessionId) {
      this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "policy",
        type: POLICY_EVENT_TYPES.DECISION,
        payload: {
          toolCallId: request.toolCallId,
          capability: request.capability,
          decision: decision.decision,
          reason: decision.reason,
          matchedRuleId: this.extractMatchedRuleId(request),
        } as PolicyDecisionPayload,
      }).catch(err => console.error("Failed to emit policy event:", err));
    }

    return decision;
  }

  private evaluatePolicy(request: ToolRequest): PolicyDecision {
    // Existing decidePolicy logic moved here
    if (request.path && isProtectedPath(this.config.permissions.protectedPaths, request.path)) {
      return { decision: "deny", reason: `Path is protected: ${request.path}` };
    }
    if (request.command && this.config.permissions.denyCommands.includes(request.command)) {
      return { decision: "deny", reason: `Command is denied: ${request.command}` };
    }
    const toolDecision = this.config.permissions.tools[request.capability];
    const mode = this.config.permissions.sessionMode ?? "ask";
    if (toolDecision) {
      const effective = applySessionMode(toolDecision, mode);
      return { decision: effective, reason: `Matched tool policy for ${request.capability} (mode: ${mode})` };
    }
    return { decision: this.config.permissions.default, reason: "Matched default policy" };
  }

  private extractMatchedRuleId(request: ToolRequest): string | undefined {
    if (request.path && isProtectedPath(this.config.permissions.protectedPaths, request.path)) {
      return "protected-path-rule";
    }
    if (request.command && this.config.permissions.denyCommands.includes(request.command)) {
      return "deny-command-rule";
    }
    if (this.config.permissions.tools[request.capability]) {
      return `tool-policy-${request.capability}`;
    }
    return "default-policy";
  }
}
```

- [ ] **Step 2: Write policy engine event tests**

Create `tests/policy/policy-engine-events.test.ts`:

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import type { AlixConfig } from "../../src/config/schema.js";

describe("Policy Engine Events", () => {
  const testDir = join(process.cwd(), ".test-policy-events");
  let eventLog: EventLog;
  let policyEngine: PolicyEngine;
  const testConfig: AlixConfig = {
    model: { provider: "openai", name: "gpt-4" },
    permissions: {
      default: "ask",
      tools: { "file.read": "allow", "file.write": "ask" },
      protectedPaths: [".env", ".git"],
    },
  } as AlixConfig;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    policyEngine = new PolicyEngine(testConfig, {
      eventLog,
      sessionId: "test-session",
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits policy.decision on every decision", async () => {
    policyEngine.decide({
      toolCallId: "call-123",
      capability: "file.read",
    });
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.ok(decisionEvent);
    const payload = decisionEvent.payload as any;
    assert.equal(payload.decision, "allow");
    assert.equal(payload.capability, "file.read");
  });

  it("emits deny decision for protected paths", async () => {
    policyEngine.decide({
      toolCallId: "call-456",
      capability: "file.read",
      path: ".env",
    });
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.equal((decisionEvent.payload as any).decision, "deny");
    assert.ok((decisionEvent.payload as any).reason.includes("protected"));
  });

  it("includes matched rule id in event", async () => {
    policyEngine.decide({
      toolCallId: "call-789",
      capability: "file.write",
    });
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.ok((decisionEvent.payload as any).matchedRuleId);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/policy/policy-engine-events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/policy/policy-engine.ts tests/policy/policy-engine-events.test.ts
git commit -m "feat(policy): emit policy.decision events for audit trail"
```

---

## Task 3: Add Approval Flow Events

**Files:**
- Modify: `src/policy/approvals.ts`
- Test: `tests/policy/approval-events.test.ts`

- [ ] **Step 1: Read current approval implementation**

```bash
cat src/policy/approvals.ts
```

- [ ] **Step 2: Update ApprovalManager to emit events**

Modify `src/policy/approvals.ts`:

```typescript
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { ApprovalRequestedPayload, ApprovalResolvedPayload } from "../events/types.js";

export type ApprovalManagerOptions = {
  eventLog?: EventLog;
  sessionId?: string;
};

export class ApprovalManager {
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  constructor(private options: ApprovalManagerOptions = {}) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    const approvalId = generateApprovalId();

    // Emit approval.requested
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: POLICY_EVENT_TYPES.APPROVAL_REQUESTED,
        payload: {
          approvalId,
          toolCallId: request.toolCallId,
          patchProposalId: request.patchProposalId,
          prompt: request.prompt,
          choices: ["approve", "deny", "edit"],
        } as ApprovalRequestedPayload,
      });
    }

    this.pendingApprovals.set(approvalId, request);

    // Prompt user (blocking)
    const userChoice = await promptUser(request.prompt);
    const result = this.resolveUserChoice(userChoice);

    // Remove from pending
    this.pendingApprovals.delete(approvalId);

    // Emit approval.resolved
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "user",
        type: POLICY_EVENT_TYPES.APPROVAL_RESOLVED,
        payload: {
          approvalId,
          decision: result.decision,
          reason: result.reason,
        } as ApprovalResolvedPayload,
      });
    }

    return result;
  }

  private resolveUserChoice(choice: string): ApprovalResult {
    if (choice === "y" || choice === "yes" || choice === "approve") {
      return { decision: "approved" };
    }
    if (choice === "e" || choice === "edit") {
      return { decision: "edited" };
    }
    return { decision: "denied", reason: "User denied" };
  }

  getPendingCount(): number {
    return this.pendingApprovals.size;
  }
}

function generateApprovalId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function promptUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(`${prompt} [y/n/e]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}
```

Add missing import:
```typescript
import { createInterface } from "node:readline";
```

- [ ] **Step 3: Write approval event tests**

Create `tests/policy/approval-events.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ApprovalManager, type ApprovalRequest } from "../../src/policy/approvals.js";

describe("Approval Events", () => {
  const testDir = join(process.cwd(), ".test-approval-events");
  let eventLog: EventLog;
  let approvalManager: ApprovalManager;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits approval.requested event", async () => {
    approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
    });

    // Mock promptUser to return "yes"
    mock.method(global, "promptUser", async () => "yes");

    await approvalManager.requestApproval({
      toolCallId: "call-123",
      prompt: "Allow file write?",
    });

    const events = await eventLog.readAll();
    const requestedEvent = events.find((e) => e.type === "approval.requested");
    assert.ok(requestedEvent);
    const payload = requestedEvent.payload as any;
    assert.ok(payload.approvalId.startsWith("approval_"));
    assert.ok(payload.choices.includes("approve"));
  });

  it("emits approval.resolved with decision", async () => {
    approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
    });

    mock.method(global, "promptUser", async () => "yes");

    await approvalManager.requestApproval({
      toolCallId: "call-123",
      prompt: "Allow file write?",
    });

    const events = await eventLog.readAll();
    const resolvedEvent = events.find((e) => e.type === "approval.resolved");
    assert.ok(resolvedEvent);
    assert.equal((resolvedEvent.payload as any).decision, "approved");
  });
});
```

Note: The mock test may need adjustment based on actual `promptUser` implementation location.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/policy/approval-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/approvals.ts tests/policy/approval-events.test.ts
git commit -m "feat(policy): emit approval lifecycle events"
```

---

## Task 4: Wire EventLog into Policy Components

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Pass EventLog to PolicyEngine**

Find where policy decisions are made in run.ts and update:

```typescript
import { PolicyEngine } from "./policy/policy-engine.js";

// Create policy engine with event log
const policyEngine = new PolicyEngine(config, {
  eventLog,
  sessionId,
});

// Use policy engine for decisions
const decision = policyEngine.decide({
  toolCallId: toolCall.id,
  capability: inferCapability(toolCall.name),
  path: args.path,
  command: args.command,
});
```

- [ ] **Step 2: Pass EventLog to ApprovalManager**

```typescript
import { ApprovalManager } from "./policy/approvals.js";

// Create approval manager with event log
const approvalManager = new ApprovalManager({
  eventLog,
  sessionId,
});

// Use for approval requests
if (decision.decision === "ask") {
  const result = await approvalManager.requestApproval({
    toolCallId: toolCall.id,
    prompt: `Allow ${capability}?`,
  });
  if (result.decision !== "approved") {
    // Handle denial
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "feat(run): wire EventLog into policy components"
```

---

## Verification

```bash
npm test -- tests/events/policy-events.test.ts tests/policy/policy-engine-events.test.ts tests/policy/approval-events.test.ts
```

All tests should pass. Manual verification:
- [ ] Every tool call has a `policy.decision` event in the log
- [ ] `approval.requested` appears when user prompt is shown
- [ ] `approval.resolved` shows final decision
- [ ] Security audit can replay policy decisions
- [ ] UI can show approval queue from event log

---

## Summary

| Task | Focus | Risk |
|------|-------|------|
| 1 | Event payload types | Low |
| 2 | PolicyEngine events | Medium |
| 3 | ApprovalManager events | Medium |
| 4 | run.ts integration | Low |