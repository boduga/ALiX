/** GE-04 Q3.18: fail closed when the legacy child provider cannot execute the contract. */
import type { QualifiedExecutorRouteContract } from './worker-executor-route-contract.js';
import { assertExecutorRouteContractMatches } from './worker-executor-route-contract.js';
import type { ModelConfig } from '../operations/config/schema.js';

/** Called before createProvider, not before existing credential/config loading. */
export function assertChildProviderRouteSupported(contract:QualifiedExecutorRouteContract,actual:ModelConfig):void {
  if (contract.fallbacks.length !== 0) throw new Error('GE-04 child provider cannot preserve authorized fallbacks');
  assertExecutorRouteContractMatches(contract,actual);
}
