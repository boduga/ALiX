# Agent Session Builder Implementation Plan

**Goal:** Decompose `createAgentSession()` into composable setup strategies with an `AgentSessionBuilder`.

**Architecture:** Extract each P0-P10 phase into a named setup function. Introduce focused strategy types (PlanConfig, ChatConfig, PersistenceConfig, EventConfig, ToolConfig) replacing the 24-field AgentSessionConfig.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-session-builder-design.md`

### Task 1: Extract setup phases + add builder

**Files:**
- Modify: `src/agent/session.ts` — split initialize() into standalone functions, add AgentSessionBuilder class

Extract the 10 initialize phases (P0-P10, lines ~418-664) into individual functions:

```ts
async function setupSession(cwd: string, sessionId: string): Promise<{...}> { ... }
async function setupWorkflow(config, agent): Promise<{...}> { ... }
async function setupResume(sessionId, sessionDir): Promise<{...}> { ... }
async function setupMemory(config): Promise<{...}> { ... }
async function setupSkills(config): Promise<{...}> { ... }
async function setupContext(config, task): Promise<{...}> { ... }
async function setupPlanGate(config): Promise<{...}> { ... }
async function setupTools(config): Promise<{...}> { ... }
async function setupSystemPrompt(config): Promise<{...}> { ... }
async function setupHooks(config): Promise<{...}> { ... }
```

Each function takes only what it needs (not the full config). initialize() becomes a sequence of calls to these functions.

Add AgentSessionBuilder class:

```ts
export class AgentSessionBuilder {
  private config: any = {};
  withPlan(cfg): this { ... return this; }
  withChat(cfg): this { ... return this; }
  withTools(cfg): this { ... return this; }
  build(): AgentSession { ... }
}
```

The existing createAgentSession() factory calls builder.build() internally for backward compatibility. No behavioral change.

Report file: /home/babasola/Projects/Monolith/.superpowers/sdd/2026-07-25-agent-session-builder/task-1-report.md

Report contract:
- Status / commits / test summary / concerns
