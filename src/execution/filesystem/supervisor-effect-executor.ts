/**
 * GE-04 supervisor effect-execution boundary — deliberately NOT operational.
 *
 * An effect-start journal record is not a syscall fence. The eventual native
 * supervisor must own the descriptor, authorization evidence, revocation
 * serialization and the actual syscall. No JavaScript callback, writable FD,
 * permit, or arbitrary executor may cross this boundary.
 *
 * Do not import this module into a production mutation router until
 * independently qualified. This contract can only reject requests.
 */
export const SUPERVISOR_EFFECT_HOLD = "GE04_SUPERVISOR_EFFECT_UNQUALIFIED" as const;

export type SupervisorEffectRequest = Readonly<{
  attemptId: string;
  retryGeneration: number;
  nonce: string;
  operation: "create" | "replace" | "delete";
  targetSha256: string;
  requestSha256: string;
}>;

export type SupervisorEffectDenial = Readonly<{
  disposition: "DENY";
  code: typeof SUPERVISOR_EFFECT_HOLD;
  effectStarted: false;
  effectsPerformed: 0;
}>;

/**
 * No injectable 'perform', 'apply', 'open', 'verify' or callback argument.
 * Even apparently valid input is rejected. The implementation deliberately
 * never opens a path, consumes a token or transitions a journal.
 */
export async function executeSupervisorEffect(_request: unknown): Promise<SupervisorEffectDenial> {
  return Object.freeze({
    disposition: "DENY" as const,
    code: SUPERVISOR_EFFECT_HOLD,
    effectStarted: false as const,
    effectsPerformed: 0 as const,
  });
}
