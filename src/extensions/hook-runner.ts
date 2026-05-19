export type HookEvent = {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: string;
};

export type HookResult = {
  event: HookEvent;
  handled?: boolean;
  abort?: boolean;
  reason?: string;
};

export type HookFn = (event: HookEvent) => Promise<HookResult | void>;

export const HOOK_TYPES = Object.freeze({
  on_pre_tool: "Before tool execution",
  on_post_tool: "After tool execution",
  on_tool_complete: "When tool completes",
  on_tool_error: "When tool fails",
  on_pre_patch: "Before patch application",
  on_post_patch: "After patch application",
  on_approval_request: "When approval needed",
  on_approval_resolved: "When approval given",
  on_session_start: "Session starts",
  on_session_end: "Session ends",
});

type ErrorCallback = (error: Error, event: HookEvent) => void;

export class HookRunner {
  private hooks = new Map<string, HookFn[]>();
  private errorCallback?: ErrorCallback;

  register(hookName: string, fn: HookFn): void {
    const existing = this.hooks.get(hookName) ?? [];
    existing.push(fn);
    this.hooks.set(hookName, existing);
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  async execute(hookName: string, event: HookEvent): Promise<HookResult> {
    const handlers = this.hooks.get(hookName) ?? [];

    if (handlers.length === 0) {
      return { event, handled: false };
    }

    let abort = false;
    let reason: string | undefined;
    let handled = false;

    for (const fn of handlers) {
      if (abort) break;

      try {
        const result = await fn(event);
        if (result) {
          handled = true;
          if (result.abort) {
            abort = true;
            reason = result.reason;
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`Hook "${hookName}" failed:`, error.message);
        this.errorCallback?.(error, event);
      }
    }

    return {
      event,
      handled,
      abort,
      reason,
    };
  }

  async executeAll(event: HookEvent): Promise<Map<string, HookResult>> {
    const results = new Map<string, HookResult>();

    for (const [name] of this.hooks) {
      const result = await this.execute(name, event);
      results.set(name, result);
    }

    return results;
  }

  getRegisteredHooks(): string[] {
    return Array.from(this.hooks.keys());
  }
}