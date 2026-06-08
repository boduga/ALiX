import { createHash } from 'node:crypto';

export interface PolicyDecision {
  id: string;
  requestId: string;
  capability: string;
  actorId: string;
  resource?: string;
  decision: 'allow' | 'ask' | 'deny' | 'modify';
  riskTier: 0 | 1 | 2 | 3 | 4 | 5;
  reasons: string[];
  argumentHash: string;
  scope: 'once' | 'session' | 'project' | 'global';
  validForToolId?: string;
  validForNodeId?: string;
  createdAt: string;
  expiresAt?: string;
}

export function hashArguments(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export function createPermissivePolicyDecision(input: {
  requestId: string;
  capability: string;
  actorId: string;
  args: unknown;
  validForToolId?: string;
  validForNodeId?: string;
}): PolicyDecision {
  return {
    id: `pol_${crypto.randomUUID()}`,
    requestId: input.requestId,
    capability: input.capability,
    actorId: input.actorId,
    decision: 'allow',
    riskTier: 0,
    reasons: ['M0.9 permissive placeholder decision'],
    argumentHash: hashArguments(input.args),
    scope: 'once',
    validForToolId: input.validForToolId,
    validForNodeId: input.validForNodeId,
    createdAt: new Date().toISOString(),
  };
}

export function assertPolicyArgumentsMatch(decision: PolicyDecision, args: unknown): void {
  const currentHash = hashArguments(args);
  if (decision.argumentHash !== currentHash) {
    throw new Error(`PolicyDecision ${decision.id} argument hash mismatch`);
  }
}
