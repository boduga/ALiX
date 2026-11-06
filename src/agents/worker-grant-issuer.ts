/** GE-04 Q3.6: in-memory synthetic authority fixture. NOT production security. */
import type { ModelConfig } from '../operations/config/schema.js';
import { bindWorkerGrant, assertWorkerGrantUse, type WorkerGrantBinding, type WorkerGrantIdentity } from './worker-grant-binding.js';

type Entry = { readonly binding: WorkerGrantBinding; readonly model: ModelConfig; used: boolean };
const keyOf = (id: WorkerGrantIdentity): string => JSON.stringify([id.coordinationRunId,id.workerId]);

/** Test harness must keep this object private: possession exposes registration authority. */
export function createSyntheticGrantIssuer() {
  const entries = new Map<string, Entry>();
  return Object.freeze({
    registerTrustedPlan(identity: WorkerGrantIdentity, model: ModelConfig): void {
      const binding = bindWorkerGrant(identity, model);
      const key = keyOf(binding.identity);
      const prior = entries.get(key);
      if (prior && binding.identity.attempt <= prior.binding.identity.attempt) {
        throw new Error('Worker attempt must advance monotonically');
      }
      // Store only a stable immutable projection; never retain caller-mutated route references.
      entries.set(key, {binding, model: structuredClone(model), used:false});
    },
    issue(identity: WorkerGrantIdentity): WorkerGrantBinding {
      const entry = entries.get(keyOf(identity));
      if (!entry || entry.used) throw new Error('Worker grant unavailable');
      assertWorkerGrantUse(entry.binding, identity, entry.model);
      return entry.binding;
    },
    consume(identity: WorkerGrantIdentity, binding: WorkerGrantBinding): void {
      const entry = entries.get(keyOf(identity));
      if (!entry || entry.used || binding !== entry.binding) throw new Error('Worker grant unavailable or unrecognized');
      assertWorkerGrantUse(entry.binding, identity, entry.model);
      entry.used = true;
    },
  });
}
