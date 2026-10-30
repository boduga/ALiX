import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

type Waiter = {
  start: () => void;
  expire: () => void;
  deadline: number;
  idleTimeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
};
type MutationQueue = { waiting: Set<Waiter>; progressAt: number };
const queues = new Map<string, MutationQueue>();

export class StoreMutationQueueTimeoutError extends Error {
  constructor() {
    super("Store mutation queue made no progress before its idle deadline");
    this.name = "StoreMutationQueueTimeoutError";
  }
}

/** Canonicalize existing ancestors too: the store file may not exist yet. */
function resourceKey(path: string): string {
  let ancestor = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try { return join(realpathSync.native(ancestor), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

/**
 * Admit one local writer per resource, across store instances and path aliases.
 * The operation must still acquire its cross-process lock and reload authority.
 * Healthy completions refresh waiting writers' idle deadlines; a stalled head
 * expires waiters without ever running their mutation callbacks.
 */
export async function serializeStoreMutation<T>(
  path: string,
  mutation: () => Promise<T>,
  idleTimeoutMs = 10_000,
): Promise<T> {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) throw new RangeError("Invalid mutation queue idle timeout");
  const key = resourceKey(path);
  const existing = queues.get(key);
  const queue = existing ?? { waiting: new Set<Waiter>(), progressAt: performance.now() };
  if (!existing) queues.set(key, queue);

  return new Promise<T>((resolveValue, reject) => {
    const advance = () => {
      const now = performance.now();
      // Check old deadlines before refreshing them: delayed timer delivery
      // must not turn a long external-lock wait into local progress.
      for (const pending of queue.waiting) {
        clearTimeout(pending.timer);
        if (now >= pending.deadline) pending.expire();
        else {
          pending.deadline = now + pending.idleTimeoutMs;
          pending.timer = setTimeout(pending.expire, pending.idleTimeoutMs);
        }
      }
      queue.progressAt = now;
      const next = queue.waiting.values().next().value;
      if (next) {
        queue.waiting.delete(next);
        next.start();
      } else queues.delete(key);
    };
    const waiter: Waiter = {
      deadline: queue.progressAt + idleTimeoutMs,
      idleTimeoutMs,
      expire: () => {
        clearTimeout(waiter.timer);
        queue.waiting.delete(waiter);
        reject(new StoreMutationQueueTimeoutError());
      },
      start: () => {
        clearTimeout(waiter.timer);
        void Promise.resolve().then(mutation).then(
          value => { advance(); resolveValue(value); },
          error => { advance(); reject(error); },
        );
      },
    };
    if (!existing) waiter.start();
    else if (waiter.deadline <= performance.now()) waiter.expire();
    else {
      queue.waiting.add(waiter);
      waiter.timer = setTimeout(waiter.expire, waiter.deadline - performance.now());
    }
  });
}
