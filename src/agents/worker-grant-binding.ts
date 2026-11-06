/** GE-04 Q3.5: test-only binding of a caller-authorized route to worker identity. */
import type { ModelConfig } from '../operations/config/schema.js';
import { planWorkerCredentialGrant } from './credential-grant-planner.js';
import { projectWorkerConfigView, type WorkerConfigView } from './worker-config-view.js';

export type WorkerGrantIdentity = Readonly<{
  coordinationRunId: string;
  workerId: string;
  attempt: number;
}>;
export type WorkerGrantBinding = Readonly<{
  identity: WorkerGrantIdentity;
  config: WorkerConfigView;
}>;

function checkedIdentity(identity: WorkerGrantIdentity): WorkerGrantIdentity {
  if (!identity || typeof identity.coordinationRunId !== 'string' ||
      !identity.coordinationRunId.trim() || typeof identity.workerId !== 'string' ||
      !identity.workerId.trim() || !Number.isSafeInteger(identity.attempt) || identity.attempt < 0) {
    throw new Error('Invalid worker grant identity');
  }
  return Object.freeze({coordinationRunId:identity.coordinationRunId,workerId:identity.workerId,attempt:identity.attempt});
}

/** Authorized model MUST originate from the caller's trusted execution plan.
 * This pure function does not establish trust in that caller or authenticate a worker.
 */
export function bindWorkerGrant(identity: WorkerGrantIdentity, authorizedModel: ModelConfig): WorkerGrantBinding {
  const verifiedIdentity=checkedIdentity(identity);
  const plan=planWorkerCredentialGrant(authorizedModel);
  return Object.freeze({identity:verifiedIdentity,config:projectWorkerConfigView(authorizedModel,plan)});
}

/** Compare a proposed use with the trusted binding; reject route/identity expansion. */
export function assertWorkerGrantUse(
  binding: WorkerGrantBinding,
  identity: WorkerGrantIdentity,
  proposedModel: ModelConfig,
): void {
  const expected=bindWorkerGrant(identity,proposedModel);
  if (!binding || !binding.identity || !binding.config ||
      binding.identity.coordinationRunId !== expected.identity.coordinationRunId ||
      binding.identity.workerId !== expected.identity.workerId ||
      binding.identity.attempt !== expected.identity.attempt ||
      binding.config.model.provider !== expected.config.model.provider ||
      binding.config.model.name !== expected.config.model.name ||
      !Array.isArray(binding.config.allowedProviders) ||
      binding.config.allowedProviders.length !== expected.config.allowedProviders.length ||
      binding.config.allowedProviders.some((provider,index)=>provider !== expected.config.allowedProviders[index])) {
    throw new Error('Worker grant binding mismatch');
  }
}
