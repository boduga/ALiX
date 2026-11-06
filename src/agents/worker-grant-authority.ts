/** GE-04 Q3.7: synthetic authority separation, not a production trust boundary. */
import type { ModelConfig } from '../operations/config/schema.js';
import { createSyntheticGrantIssuer } from './worker-grant-issuer.js';
import type { WorkerGrantIdentity, WorkerGrantBinding } from './worker-grant-binding.js';

export type TrustedPlanRegistrar = Readonly<{
  registerTrustedPlan(identity: WorkerGrantIdentity, model: ModelConfig): void;
}>;
export type GrantAccessPort = Readonly<{
  issue(identity: WorkerGrantIdentity): WorkerGrantBinding;
  consume(identity: WorkerGrantIdentity, binding: WorkerGrantBinding): void;
}>;

/** The trusted test harness retains scheduler; only access is shared with worker-facing code.
 * A caller receiving both ports has full authority; no process authentication is provided.
 */
export function createSyntheticGrantAuthority(): Readonly<{
  scheduler: TrustedPlanRegistrar;
  access: GrantAccessPort;
}> {
  const issuer = createSyntheticGrantIssuer();
  const scheduler: TrustedPlanRegistrar = Object.freeze({
    registerTrustedPlan: (identity, model) => issuer.registerTrustedPlan(identity, model),
  });
  const access: GrantAccessPort = Object.freeze({
    issue: (identity) => issuer.issue(identity),
    consume: (identity, binding) => issuer.consume(identity, binding),
  });
  return Object.freeze({ scheduler, access });
}
