/**
 * wait-until.ts — shared load-insensitive async poll for kernel tests.
 *
 * A slow CI runner must wait as long as it needs rather than losing a fixed
 * `setTimeout` race. Extracted so the coordination-scheduler, finalization, and
 * replan suites share one implementation (they had drifted into three copies,
 * one of which swallowed the timeout silently).
 */

/**
 * Poll until `cond` is true or `timeoutMs` elapses. Throws on timeout: a silent
 * deadline that masquerades as a product defect (e.g. `0 !== 1` on an aggregate
 * event) is worse than a loud failure, so the caller always learns the wait
 * expired.
 */
export async function waitUntil(cond: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!(await cond()) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!(await cond())) {
    throw new Error(`waitUntil: condition still false after ${timeoutMs}ms`);
  }
}
