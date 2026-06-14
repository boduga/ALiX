/**
 * circuit-breaker.ts — Per-provider circuit breaker.
 *
 * States: closed (normal), open (failing — fast-fail), half-open (probing).
 * Transitions: consecutive failures → open, cooldown timeout → half-open,
 * successful probe → closed.
 */

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitOptions = {
  failureThreshold?: number;   // consecutive failures to trip (default 3)
  cooldownMs?: number;         // time before half-open probe (default 30s)
};

const DEFAULTS = { failureThreshold: 3, cooldownMs: 30000 };

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private opts: Required<CircuitOptions>;

  constructor(opts: CircuitOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  getState(): CircuitState { return this.state; }

  /** Call before each request. Throws if circuit is open. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.opts.cooldownMs) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open — provider unavailable");
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e: any) {
      this.onFailure();
      throw e;
    }
  }

  onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "half-open") this.state = "closed";
  }

  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.opts.failureThreshold) {
      this.state = "open";
    }
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
