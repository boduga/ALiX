export type Permission = "operator" | "admin" | "developer" | "internal";

/** Pure-data capability definition. Fully serializable — no functions. */
export interface Capability {
  id: string;                       // namespaced: "core.session.list"
  version: string;
  kind: "core" | "tool" | "skill" | "custom" | "workflow" | "plugin";
  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: "low" | "medium" | "high" | "critical";
  requiredPermissions: Permission[];
  argsSchema?: Record<string, unknown>;   // JSON Schema object
  resultSchema?: Record<string, unknown>; // JSON Schema object
  examples?: string[];
  execution: {
    strategy: string;               // "native" | "tool" | "daemon" | "agent" | "cli" | ...
    timeout?: number;               // ms
    cancellable?: boolean;
  };
  dependencies?: string[];
  extensions?: Record<string, unknown>;
}

/** Dynamic runtime state — separated from Capability metadata.
 *  Phase 1 co-locates status storage with the registry; a future
 *  CapabilityStatusStore may extract it. */
export interface CapabilityStatus {
  capabilityId: string;
  availability: "available" | "unavailable" | "degraded";
  health: "healthy" | "warning" | "error";
  lastChecked: number;
}

export type InvocationStatus =
  | "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";

export interface InvocationResult {
  invocationId: string;
  status: InvocationStatus;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface Invocation {
  id: string;
  /** Read-only getter — reflects live state, not a frozen snapshot. */
  readonly status: InvocationStatus;
  startedAt?: number;
  completedAt?: number;
  cancel(): void;
  subscribe(handler: (evt: CapabilityEvent) => void): () => void;
  wait(): Promise<InvocationResult>;
  result(): InvocationResult | undefined;
  events(): AsyncIterable<CapabilityEvent>;
}

export type CapabilityEvent =
  | { type: "CapabilityRegistered"; capabilityId: string; at: number }
  | { type: "CapabilityRemoved"; capabilityId: string; at: number }
  | { type: "InvocationStarted"; invocationId: string; capabilityId: string; at: number }
  | { type: "InvocationProgress"; invocationId: string; progress: number; at: number }
  | { type: "InvocationOutput"; invocationId: string; chunk: string; at: number }
  | { type: "InvocationCompleted"; invocationId: string; at: number }
  | { type: "InvocationFailed"; invocationId: string; error: string; at: number }
  | { type: "InvocationCancelled"; invocationId: string; at: number }
  | { type: "PermissionDenied"; capabilityId: string; actor: string; at: number }
  | { type: "AvailabilityChanged"; capabilityId: string; status: CapabilityStatus; at: number };

/** Context passed to every invocation. */
export interface CapabilityContext {
  invocationId: string;
  requestId: string;
  actor: string;
  permissions: Permission[];
  cwd: string;
  workspace: string;
  sessionId: string;
  cancellationToken: AbortSignal;
  eventBus: EventBusLike;
}

export interface EventBusLike {
  emit(event: CapabilityEvent): void;
}

export interface ExecutorRunResult {
  output?: unknown;
  error?: string;
}

/** In-memory FIFO async event queue. No persistence, no history.
 *  Drives Invocation.events(). Ordering is preserved for slow consumers. */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.buffer.push(item);
    this.waiters.shift()?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters) w();
    this.waiters = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
