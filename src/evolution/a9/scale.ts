/**
 * A9 — small numeric helpers shared by the pure detectors and builder.
 *
 * These are the only shared numeric utilities in the A9 module. Both are
 * deterministic; neither does I/O, reads a clock, or mutates configuration.
 *
 * @module evolution/a9/scale
 */

/** Clamp a finite number into [0,1]. NaN propagates (Math.min/max semantics) —
 *  callers sanitize inputs, so NaN surfaces loudly in the builder's
 *  `assertUnitInterval` validation rather than being silently swallowed. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Assert a value is a finite number in [0,1]; throws RangeError otherwise. */
export function assertUnitInterval(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number in [0, 1]; received ${String(value)}`);
  }
}
