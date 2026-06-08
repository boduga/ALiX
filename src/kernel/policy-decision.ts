import { createHash, randomUUID } from "node:crypto";

export interface PolicyDecision {
  id: string;
  requestId: string;
  capability: string;
  actorId: string;
  resource?: string;
  decision: "allow" | "ask" | "deny" | "modify";
  riskTier: 0 | 1 | 2 | 3 | 4 | 5;
  reasons: string[];
  argumentHash: string;
  scope: "once" | "session" | "project" | "global";
  validForToolId?: string;
  validForNodeId?: string;
  createdAt: string;
  expiresAt?: string;
}

/** Compute stable SHA-256 of sorted-JSON arguments. */
export function hashArguments(args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = args[k];
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Create a permissive M0.9 placeholder PolicyDecision. */
export function createPermissivePolicyDecision(input: {
  requestId: string;
  capability: string;
  actorId: string;
  args: Record<string, unknown>;
  validForToolId?: string;
  validForNodeId?: string;
}): PolicyDecision {
  return {
    id: `pol_${randomUUID()}`,
    requestId: input.requestId,
    capability: input.capability,
    actorId: input.actorId,
    decision: "allow",
    riskTier: 0,
    reasons: ["M0.9 permissive placeholder — full policy enforcement in M0.12+"],
    argumentHash: hashArguments(input.args),
    scope: "once",
    validForToolId: input.validForToolId,
    validForNodeId: input.validForNodeId,
    createdAt: new Date().toISOString(),
  };
}

/** Throw if the current arguments don't match the approved hash. */
export function assertPolicyArgumentsMatch(decision: PolicyDecision, args: Record<string, unknown>): void {
  const currentHash = hashArguments(args);
  if (decision.argumentHash !== currentHash) {
    throw new Error(`PolicyDecision ${decision.id} argument hash mismatch: expected ${decision.argumentHash}, got ${currentHash}`);
  }
}
