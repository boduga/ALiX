/**
 * src/tracing/warn-once.ts
 *
 * Minimal warn-once helper for the tracing module. Recon (plan Task 1) found no
 * generic warn-once utility in the repo, so this small module-scoped helper
 * exists for the tracing client factory (src/tracing/client-factory.ts): a
 * Langfuse construction failure must warn exactly once per process even though
 * the factory may be invoked from multiple bootstrap seams (design §4, §11).
 *
 * `warnOnce(message)` emits `console.warn(message)` the first time a given
 * `key` is seen and stays silent for every later call with the same key. The
 * default key is the message text itself; callers that want to dedupe across
 * varying message detail can pass an explicit stable key.
 *
 * Kept local to src/tracing — promote to a shared utility only when a second
 * consumer outside this module appears.
 *
 * Created by: Task 9 (implement the tracing client factory) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

const EMITTED_KEYS = new Set<string>();

/**
 * Emit `console.warn(message)` once per process for a given key.
 *
 * @param message — the warning text.
 * @param key — dedupe key; defaults to `message`. Pass an explicit stable key
 *   when the message embeds throw detail that varies between attempts.
 */
export function warnOnce(message: string, key: string = message): void {
  if (EMITTED_KEYS.has(key)) return;
  EMITTED_KEYS.add(key);
  console.warn(message);
}
