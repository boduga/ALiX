/**
 * projector.ts — Decision-specific projector contract (J0b).
 *
 * Each decision owns a projector: ExecutionState/runtime objects in, minimal
 * typed projection out. Projection runs before redaction; redaction runs
 * before remote transport. A throwing projector blocks the remote call —
 * validation failure never reaches the provider.
 */

import type { DecisionType } from "./contracts.js";
import { sealForRemote, type RemoteSealedProjection } from "./boundary.js";

export type Projector<TInput, TProjection extends Record<string, unknown>> = {
  decision: DecisionType;
  version: string;
  project(input: TInput): TProjection;
};

/** Project then gate + seal. Projector throws propagate; nothing seals. */
export function projectForRemote<TInput, TProjection extends Record<string, unknown>>(
  projector: Projector<TInput, TProjection>,
  input: TInput,
  opts?: { now?: number },
): RemoteSealedProjection<TProjection> {
  const payload = projector.project(input);
  return sealForRemote(projector.decision, projector.version, payload, opts);
}
