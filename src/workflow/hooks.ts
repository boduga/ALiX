/**
 * P4.6a — Hook System: lifecycle interceptors for the agent execution stack.
 *
 * Hooks are synchronous functions that run before/after every significant
 * lifecycle event: agent runs, tool calls, commits, PR creation, and
 * workflow transitions.
 *
 * A pre-hook returning `false` blocks the operation.
 *
 * Hook types:
 *   pre/post AgentRun     — before/after an agent executes
 *   pre/post ToolUse      — before/after a tool call (file write, shell, etc.)
 *   pre/post Commit       — before/after a git commit
 *   pre/post PRCreate     — before/after a PR is created
 *   pre/post Transition   — before/after a workflow state change
 *   onFailure             — when any step fails
 *   onHumanGate           — when waiting for human approval
 *
 * @module
 */

export type HookType =
  | "preAgentRun" | "postAgentRun"
  | "preToolUse" | "postToolUse"
  | "preCommit" | "postCommit"
  | "prePRCreate" | "postPRCreate"
  | "preTransition" | "postTransition"
  | "onFailure" | "onHumanGate";

export const HOOK_TYPES: ReadonlySet<string> = new Set<HookType>([
  "preAgentRun", "postAgentRun",
  "preToolUse", "postToolUse",
  "preCommit", "postCommit",
  "prePRCreate", "postPRCreate",
  "preTransition", "postTransition",
  "onFailure", "onHumanGate",
]);

export interface HookContext {
  type: HookType;
  agentId?: string;
  toolName?: string;
  files?: string[];
  commitSha?: string;
  commitMessage?: string;
  issueNumber?: number;
  fromState?: string;
  toState?: string;
  error?: string;
  [key: string]: unknown;
}

export type HookFn = (ctx: HookContext) => boolean | void | Promise<boolean | void>;

/**
 * HookManager — register, remove, and run lifecycle hooks.
 *
 * Each hook type can have multiple handlers. Handlers run in registration
 * order. If any pre-hook returns `false`, the operation is blocked.
 */
export class HookManager {
  private hooks = new Map<HookType, HookFn[]>();

  constructor() {
    for (const type of HOOK_TYPES) {
      this.hooks.set(type as HookType, []);
    }
  }

  register(type: HookType, fn: HookFn): void {
    if (!HOOK_TYPES.has(type)) {
      throw new Error(`Unknown hook type: "${type}". Valid: ${Array.from(HOOK_TYPES).join(", ")}`);
    }
    this.hooks.get(type)!.push(fn);
  }

  remove(type: HookType): void {
    this.hooks.set(type, []);
  }

  async run(type: HookType, ctx: HookContext): Promise<boolean> {
    const handlers = this.hooks.get(type) ?? [];
    for (const fn of handlers) {
      const result = await fn(ctx);
      if (result === false) return false;
    }
    return true;
  }
}
