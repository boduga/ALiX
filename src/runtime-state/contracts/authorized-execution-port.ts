// src/runtime-state/contracts/authorized-execution-port.ts
//
// R1 boundary freeze — AuthorizedExecutionPort.
// Execution only with a verifiable authorization envelope.
// `source: "operator"` must be explicitly issued, never inferred
// from a generic approved status. `verificationPassed` must not
// imply authorization.

export type AuthorizationSource = "operator" | "policy" | "delegated" | "system";

export interface AuthorizationEnvelope {
  authorizationId: string;
  source: AuthorizationSource;
  subject: string;
  capabilities: readonly string[];
  scope: unknown;
  issuedAt: string;
  expiresAt?: string;
  evidenceRef: string;
}

export type AuthorizedExecutionOutcome =
  | { ok: true; evidenceRef: string }
  | { ok: false; error: string };

export interface AuthorizedExecutionPort {
  execute(envelope: AuthorizationEnvelope, request: unknown): Promise<AuthorizedExecutionOutcome>;
}
