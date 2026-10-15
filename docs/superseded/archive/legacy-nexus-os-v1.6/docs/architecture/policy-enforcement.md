# Policy Enforcement

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 13. Governance, Security, and Safety Requirements

| Risk Tier | Examples | Default Action |
|---|---|---|
| Tier 0: read-only | Read files, search memory, inspect repo | allow |
| Tier 1: local write | Create doc, edit non-critical file, write artifact | ask or allow by mode |
| Tier 2: shell/network | Run shell command, fetch web data, install package | ask |
| Tier 3: external mutation | GitHub write, email draft/send, calendar write | ask |
| Tier 4: money/security/identity | Secrets, credentials, payments, firewall rules | ask/deny by default |
| Tier 5: destructive privileged | sudo, delete many files, production deploy | deny unless explicitly elevated |

- Every tool and agent action is mapped to capabilities in the Capability Taxonomy (§21).
- Policies are evaluated before tool calls, memory writes, agent spawning, and external side effects.
- Approval dialogs must show reason, affected resources, rollback plan, and expected side effects.
- Sandbox profiles must define network, filesystem mounts, secrets, timeout, memory, and shell permissions.
- Audit logs must include actor, delegated actor, task node, tool, arguments summary, policy decision, and result.

---

## 32. Policy Enforcement Architecture

Policy is enforced at every execution boundary, not only in the orchestrator.

### 32.1 Enforcement Points

| Boundary | Required Policy Check |
|---|---|
| Agent spawn | `agent.spawn`, target agent risk, memory access |
| Agent delegation | `agent.delegate`, delegation depth, allowed capabilities |
| Model call | Sensitivity of context, cloud/local routing, budget |
| Tool call | Tool capability, risk tier, sandbox, side effects |
| Sidecar invocation | Sidecar capability, file access, timeout, sandbox |
| Memory write | Scope, sensitivity, approval requirement |
| Artifact publish/export | Sensitivity, destination, external visibility |
| Graph mutation | `graph.mutate`, actor identity, mutation scope |
| External mutation | Email, calendar, GitHub write, deployment, payment, network POST |

### 32.2 PolicyDecision Object

```typescript
type PolicyDecision = {
  id: string;
  requestId: string;
  capability: string;
  actorId: string;
  resource?: string;
  decision: "allow" | "ask" | "deny";
  riskTier: 0 | 1 | 2 | 3 | 4 | 5;
  reasons: string[];
  requiredSandbox?: string;
  argumentHash: string;              // hash of exact approved arguments
  scope: "once" | "session" | "project" | "global";
  validForToolId?: string;
  validForNodeId?: string;
  createdAt: string;
  expiresAt?: string;
  approvedBy?: "user" | "policy";
};
```

**Rules:**
- No tool executes without a valid PolicyDecision.
- No sidecar executes without a valid PolicyDecision.
- No agent may escalate its own permissions.
- Approval decisions must be persisted as events.
- Approval may be scoped to `once`, `session`, `project`, or `global`.
- A PolicyDecision is invalid if the tool arguments differ from the approved `argumentHash`.
- Global approvals require an explicit configuration flag and must never be inferred from a casual approval.

### 32.3 Approval UX Options

Every approval request must offer:

```
approve once
approve for this session
approve for this project
deny once
deny for this session
modify arguments
run dry-run first
show diff
show rollback plan
delegate to safer tool
```

---

## 46. PolicyDecision Argument Binding

A PolicyDecision must approve the exact action requested, not merely the general capability.

### 46.1 Argument Hashing

Before a tool, sidecar, memory write, or external mutation executes, ALiX computes a canonical JSON representation of the arguments and stores its hash in `PolicyDecision.argumentHash`.

Rules:

- The executing tool must present the same argument hash before execution.
- If the arguments change, the PolicyDecision is invalid and policy must be re-evaluated.
- Approval scope cannot expand arguments beyond the approved resource pattern.
- `approve for this project` may approve a class of actions only when the policy explicitly declares a safe argument pattern.
- `global` scope approval is disabled by default and must be enabled in configuration.

### 46.2 Binding Fields

| Field | Purpose |
|---|---|
| `argumentHash` | Binds approval to exact arguments |
| `validForToolId` | Prevents approval reuse across tools |
| `validForNodeId` | Prevents approval reuse across unrelated graph nodes |
| `scope` | Defines once/session/project/global lifetime |
| `expiresAt` | Forces re-approval after expiration |

---


## v1.5 Hardening Note: Argument Binding

A PolicyDecision must be bound to the approved action arguments. Include `argumentHash`, `scope`, `validForToolId`, `validForNodeId`, and `createdAt`. A PolicyDecision is invalid if the tool arguments differ from the approved `argumentHash`.
