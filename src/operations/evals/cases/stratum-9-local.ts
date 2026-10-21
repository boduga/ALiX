/**
 * Stratum 9 — local CPU-only execution.
 *
 * This is an ENVIRONMENT AXIS, not a new behavioural case. The PRD treats it as a
 * qualification dimension ("CPU-only execution"), so the correct representation
 * is: the same deterministic cases, executed with a local/no-network provider
 * under a CPU-only environment, reported as a distinct stratum.
 *
 * Why not a new EvalCase: the behaviour under test is identical; only the
 * execution environment differs. Duplicating every case for CPU-only would double
 * the case set for no additional behavioural coverage, and the evaluator's
 * scoring contract already handles the outcome.
 *
 * What this module provides:
 *   - the environment descriptor recorded with any CPU-only observation
 *   - the provider ids that count as "local / CPU-only"
 *   - a guard that refuses to label a networked-provider run as CPU-only
 *
 * The local providers in this codebase are `ollama` and `local-llama`. Both are
 * classified non-billable (F1-C), which is exactly right for a local run: it has
 * resource cost, not token-billed cost.
 */

/** Environment descriptor attached to a CPU-only observation. */
export const CPU_ONLY_ENVIRONMENT = {
  cpuOnly: true,
  network: false,
} as const;

/** Providers that execute locally (no remote inference). */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "local-llama"]);

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider.toLowerCase());
}

export type CpuOnlyLabelCheck = {
  ok: boolean;
  reason?: string;
};

/**
 * Guard: a run may only be labelled CPU-only when every provider that actually
 * executed was local.
 *
 * This exists because a mixed run (some local, some remote) attributed to the
 * CPU-only stratum would silently misrepresent platform coverage — the PRD's
 * stratum 9 is a claim about running without remote inference.
 */
export function canLabelCpuOnly(providersUsed: readonly string[]): CpuOnlyLabelCheck {
  if (providersUsed.length === 0) {
    return { ok: false, reason: "no providers observed; cannot claim CPU-only execution" };
  }
  const remote = [...new Set(providersUsed.filter(p => !isLocalProvider(p)))];
  if (remote.length > 0) {
    return {
      ok: false,
      reason: `remote inference used (${remote.join(", ")}); a CPU-only claim requires local-only providers`,
    };
  }
  return { ok: true };
}

/**
 * Derive the providers that actually executed from a recorded `EvalRun`.
 *
 * Reads `execution.provider` per case — the provider recorded when the case ran,
 * not what the operator intended. A case whose provider is unknown is returned
 * as the literal `unknown`, which the guard treats as non-local and therefore
 * refuses. Fail closed: an unattributable run cannot support a CPU-only claim.
 */
export function observedProviders(run: {
  provider?: string;
  results: Array<{ execution?: { provider?: string } }>;
}): string[] {
  const seen = new Set<string>();
  for (const result of run.results) {
    seen.add(result.execution?.provider ?? "unknown");
  }
  if (seen.size === 0 && run.provider) seen.add(run.provider);
  return [...seen];
}

/**
 * Decide whether a recorded run may be counted as stratum 9 (local CPU-only).
 *
 * Returns the guard verdict plus the evidence that produced it, so the claim can
 * be audited later without re-deriving which providers ran.
 */
export function classifyCpuOnlyRun(run: {
  provider?: string;
  results: Array<{ execution?: { provider?: string } }>;
}): CpuOnlyLabelCheck & { providers: string[] } {
  const providers = observedProviders(run);
  return { ...canLabelCpuOnly(providers), providers };
}
