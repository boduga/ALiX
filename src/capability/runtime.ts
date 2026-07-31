// src/capability/runtime.ts
import { randomUUID } from "node:crypto";
import { CapabilityNotFoundError, ExecutorNotFoundError } from "./errors.js";
import { AsyncEventQueue, type CapabilityContext, type CapabilityEvent, type EventBusLike, type ExecutorRunResult, type Invocation, type InvocationResult, type InvocationStatus, type Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { HookRegistry } from "./hook-registry.js";
import type { ExecutionResolver } from "./execution-resolver.js";
import type { ExecutorRegistry } from "./executors.js";
import type { EventBus } from "./event-bus.js";

interface InternalState {
  status: InvocationStatus;
  result?: InvocationResult;
  queue: AsyncEventQueue<CapabilityEvent>;
  resolve: (r: InvocationResult) => void;
  abort: AbortController;
  settled: boolean;
}

/** Owns no invocation registry and no lifecycle history. Invocation state
 *  is encapsulated by the returned handles; the runtime creates state but
 *  does not retain it. Cancellation flows through the Invocation object. */
export class CapabilityRuntime {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly hooks: HookRegistry,
    private readonly resolver: ExecutionResolver,
    private readonly executors: ExecutorRegistry,
    private readonly bus: EventBus,
  ) {}

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    const capability = this.registry.find(capabilityId);
    if (!capability) throw new CapabilityNotFoundError(capabilityId);
    const plans = this.resolver.resolve(capabilityId, this.makeContext(capabilityId, overrides));
    const plan = plans[0];
    const step = plan?.steps[0];
    if (!step) throw new CapabilityNotFoundError(capabilityId);
    const executor = this.executors.get(step.executor);
    if (!executor) throw new ExecutorNotFoundError(step.executor);

    const invocationId = `inv_${randomUUID().slice(0, 8)}`;
    const startedAt = Date.now();
    const abort = new AbortController();
    const queue = new AsyncEventQueue<CapabilityEvent>();
    const st: InternalState = {
      status: "queued",
      queue,
      resolve: () => {},
      abort,
      settled: false,
    };

    const finish = (status: InvocationStatus, extra: Partial<InvocationResult> = {}): InvocationResult => {
      if (st.settled) return st.result!;
      st.settled = true;
      st.status = status;
      const r: InvocationResult = {
        invocationId, status, startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, ...extra,
      };
      st.result = r;
      queue.close();
      st.resolve(r);
      return r;
    };

    const inv: Invocation = {
      id: invocationId,
      get status() { return st.status; },   // live getter, not a frozen value
      startedAt,
      cancel: () => {
        if (st.status !== "running" && st.status !== "queued") return;
        st.abort.abort();
        const r = finish("cancelled");
        queue.push({ type: "InvocationCancelled", invocationId, at: Date.now() });
        this.bus.emit({ type: "InvocationCancelled", invocationId, at: Date.now() });
        st.resolve(r);
      },
      subscribe: (h) => this.bus.subscribe(h),
      wait: () => new Promise<InvocationResult>((resolve) => {
        if (st.result) resolve(st.result);
        else st.resolve = resolve;
      }),
      result: () => st.result,
      events: () => queue,
    };

    void (async () => {
      // Yield once so the async body does not advance until invoke() has
      // returned to the caller. Otherwise the caller can never observe the
      // "queued" status, and a synchronous cancel() (invoke() → cancel()
      // immediately) would race past the guard below and start the executor.
      await Promise.resolve();

      const ctx = this.makeContext(capabilityId, overrides, invocationId, abort.signal);
      const hooks = this.hooks.get(capabilityId);

      const fail = (error: string): void => {
        const r = finish("failed", { error });
        queue.push({ type: "InvocationFailed", invocationId, error, at: Date.now() });
        this.bus.emit({ type: "InvocationFailed", invocationId, error, at: Date.now() });
      };

      try {
        // Cancellation race guard: if cancelled before the async body
        // started (invoke() → cancel() immediately), do NOT run the executor.
        if (abort.signal.aborted) { inv.cancel(); return; }

        if (hooks?.validate) {
          const problem = hooks.validate(args, ctx);
          if (problem) return fail(problem);
        }
        if (hooks?.canInvoke && !hooks.canInvoke(ctx)) {
          this.bus.emit({ type: "PermissionDenied", capabilityId, actor: ctx.actor, at: Date.now() });
          return fail("Permission denied");
        }
        st.status = "running";
        this.bus.emit({ type: "InvocationStarted", invocationId, capabilityId, at: Date.now() });
        queue.push({ type: "InvocationStarted", invocationId, capabilityId, at: Date.now() });
        await hooks?.beforeInvoke?.(ctx);
        let runResult: ExecutorRunResult;
        try {
          runResult = await executor.run(capability, ctx, args);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        if (abort.signal.aborted) { inv.cancel(); return; }
        if (runResult.error) return fail(runResult.error);
        const r = finish("completed", { output: runResult.output });
        queue.push({ type: "InvocationCompleted", invocationId, at: Date.now() });
        this.bus.emit({ type: "InvocationCompleted", invocationId, at: Date.now() });
        await hooks?.afterInvoke?.(r, ctx);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    })();

    return inv;
  }

  private makeContext(
    capabilityId: string,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
    invocationId = `inv_${randomUUID().slice(0, 8)}`,
    signal?: AbortSignal,
  ): CapabilityContext {
    return {
      invocationId,
      requestId: `req_${randomUUID().slice(0, 8)}`,
      actor: overrides.actor ?? "operator",
      permissions: overrides.permissions ?? ["operator"],
      cwd: overrides.cwd ?? process.cwd(),
      workspace: overrides.workspace ?? process.cwd(),
      sessionId: overrides.sessionId ?? "",
      cancellationToken: signal ?? new AbortController().signal,
      eventBus: this.bus as EventBusLike,
    };
  }
}
