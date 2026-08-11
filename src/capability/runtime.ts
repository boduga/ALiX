// src/capability/runtime.ts
import { randomUUID } from "node:crypto";
import { CapabilityNotFoundError, ProviderUnavailableError } from "./errors.js";
import { AsyncEventQueue, type CapabilityContext, type CapabilityEvent, type EventBusLike, type Invocation, type InvocationResult, type InvocationStatus, type Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { HookRegistry } from "./hook-registry.js";
import type { ProviderResolver } from "./provider-resolver.js";
import { isFallbackEligibleKind, classifyErrorKind, type ProviderRunResult } from "./provider-executor.js";
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
    private readonly resolver: ProviderResolver,
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
    const steps = plan?.steps;
    if (!steps || steps.length === 0) throw new CapabilityNotFoundError(capabilityId);

    // Backward-compatible synchronous error for the single-step case: a
    // capability with no eligible provider throws immediately (the legacy
    // "missing executor" contract). Multi-step plans resolve providers
    // per-step in the async body and fail the composite instead.
    if (steps.length === 1 && steps[0]!.candidates.length === 0) {
      throw new ProviderUnavailableError(capabilityId, steps[0]!.bindingsCount === 0 ? "missing_binding" : "provider_unavailable");
    }

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

    const emitTerminal = (evt: CapabilityEvent): void => {
      // Must run BEFORE finish() closes the queue, so a consumer iterating
      // inv.events() still drains the terminal event.
      queue.push(evt);
      this.bus.emit(evt);
    };

    const inv: Invocation = {
      id: invocationId,
      get status() { return st.status; },   // live getter, not a frozen value
      startedAt,
      cancel: () => {
        if (st.status !== "running" && st.status !== "queued") return;
        st.abort.abort();
        emitTerminal({ type: "InvocationCancelled", invocationId, at: Date.now() });
        finish("cancelled");
      },
      subscribe: (h) => queue.subscribe(h),
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
        if (st.settled) return; // already settled (e.g. cancelled): do not emit a contradictory InvocationFailed
        emitTerminal({ type: "InvocationFailed", invocationId, error, at: Date.now() });
        finish("failed", { error });
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

        // Phase 3 (#308): execute the multi-step composition plan in order.
        // Each dependency step runs first (its output feeding the next step),
        // and the capability's own step runs last. A failed dependency fails
        // the whole composite.
        let stepArgs = args;
        // The serving provider of the LAST successful step (the capability's
        // own step) is carried to the result. Set only on a success branch;
        // fail() never passes it. Declared here (not inside the loop) so the
        // post-loop completion can read it.
        let serving: { providerId: string; providerType: string; bindingIndex: number } | undefined;
        for (const step of steps) {
          if (abort.signal.aborted) { inv.cancel(); return; }
          const stepCap = this.registry.find(step.capabilityId);
          if (!stepCap) return fail(`Unknown capability '${step.capabilityId}'`);
          // Nothing eligible to resolve: distinguish missing_binding (no
          // bindings declared) from provider_unavailable (bindings existed,
          // but no provider is usable). Availability change, NEVER a lifecycle
          // change (#476, #481).
          if (step.candidates.length === 0) {
            const reason = step.bindingsCount === 0 ? "missing_binding" : "provider_unavailable";
            this.registry.setAvailability(step.capabilityId, { available: false, reason });
            return fail(`No available provider for '${step.capabilityId}' (${reason})`);
          }
          let stepOutput: Record<string, unknown> | undefined;
          let served = false;
          for (const candidate of step.candidates) {
            if (abort.signal.aborted) { inv.cancel(); return; }
            let runResult: ProviderRunResult;
            try {
              runResult = await candidate.executor.run(candidate.binding, stepCap, ctx, stepArgs);
            } catch (e) {
              // Execution threw → classify through the closed R1 function, not
              // a hard-coded "unavailable" (Global Constraints "R1 Taxonomy").
              runResult = { error: e instanceof Error ? e.message : String(e), errorKind: classifyErrorKind(e as { code?: string }) };
            }
            if (runResult.error !== undefined) {
              // R1 error-class gate: provider failure → next candidate
              // (bounded single pass); capability/fatal → fail immediately.
              if (isFallbackEligibleKind(runResult.errorKind)) continue;
              return fail(runResult.error);
            }
            stepOutput = (runResult.output ?? {}) as Record<string, unknown>;
            served = true;
            serving = { providerId: candidate.providerId, providerType: candidate.providerType, bindingIndex: candidate.bindingIndex };
            break;
          }
          if (!served) {
            this.registry.setAvailability(step.capabilityId, { available: false, reason: "provider_unavailable" });
            return fail(`No provider available for '${step.capabilityId}' (provider_unavailable)`);
          }
          // !served returned above, so stepOutput was assigned by the success branch.
          stepArgs = stepOutput!;
        }

        // The serving provider is a first-class execution fact (identity stays
        // the capability; the provider identity is what changes across attempts).
        emitTerminal({ type: "InvocationCompleted", invocationId, at: Date.now() });
        const r = finish("completed", { output: stepArgs, servingProvider: serving });
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
