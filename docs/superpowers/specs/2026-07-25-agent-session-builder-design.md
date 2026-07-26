# Agent Session Builder — Design Spec

**Date:** 2026-07-25
**Status:** Draft

## Problem

`createAgentSession()` in `src/agent/session.ts` is a 1,031-line factory function with 25+ mutable closure variables and 24+ optional config fields. `initialize()` runs 10 phases (P0-P10) in one monolithic pass. `processTurn()` has 4 routing paths in one method.

## Design

Replace the flat factory with an `AgentSessionBuilder` that uses composable setup strategies.

### Builder interface

```ts
export class AgentSessionBuilder {
  private config: Partial<AgentSessionConfig> = {};
  
  withPlan(config: PlanConfig): this;
  withChat(config: ChatConfig): this;
  withPersistence(config: PersistenceConfig): this;
  withEvents(config: EventConfig): this;
  withTools(config: ToolConfig): this;
  
  build(): AgentSession;
}
```

### Strategy extraction

Each P0-P10 phase becomes a named setup function taking only what it needs:

| Phase | Current lines | Extracted to | Dependencies |
|-------|--------------|--------------|--------------|
| P0: Session init | 420-440 | `setupSession()` | cwd, sessionId |
| P1: Workflow | 440-480 | `setupWorkflow()` | config, agent |
| P2: Resume | 480-530 | `setupResume()` | sessionId |
| P3: Memory | 530-560 | `setupMemory()` | config |
| P4: Skills | 560-590 | `setupSkills()` | config |
| P5: Context | 590-640 | `setupContext()` | config, task |
| P6: Plan | 640-670 | `setupPlanGate()` | config |
| P7: Tools | 670-900 | `setupTools()` | config |
| P8: Prompt | 900-1000 | `setupSystemPrompt()` | config |
| P9: Hooks | 1000-1030 | `setupHooks()` | config |

### Config decomposition

Replace the single 24-field `AgentSessionConfig` with focused strategy types:

```ts
interface PlanConfig { approvalMode: PlanApprovalMode; gate?: PlanApprovalGate; }
interface ChatConfig { chatSearchTool?: (q: string) => Promise<string>; }
interface PersistenceConfig { eventLog?: EventLog; approvalStore?: ApprovalStore; }
interface EventConfig { onStream?: (token: string) => void; onToolCall?: (call: ToolCall) => void; }
interface ToolConfig { tools?: ToolDescriptor[]; }
```
