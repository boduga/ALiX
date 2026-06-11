/**
 * ifamas-pipeline.ts -- IFÁ-MAS Passive Diagnostic Pipeline
 *
 * Thin passive orchestrator that chains the 8 IFÁ-MAS modules into a single
 * end-to-end diagnostic pipeline.  Pure orchestration -- no new logic.
 *
 * Hard rules:
 * - NO import of ToolExecutor
 * - NO import of PolicyGate
 * - NO import of ApprovalStore
 * - No tool execution, no routing mutation, no file/network side effects
 *   (except optional ChronicleStore read inside routeViaNexus)
 */

import { prescribeOffering } from "./offering-planner.js";
import type { OfferingPlan } from "./offering-planner.js";
import { buildBridgeEnvelope } from "./bridge-envelope.js";
import type { BridgeEnvelope } from "./bridge-envelope.js";
import { BridgeGateway } from "./bridge-gateway.js";
import type { BridgeValidationResult } from "./bridge-gateway.js";
import { routeViaNexus } from "./nexus-router.js";
import type { NexusRouteDecision } from "./nexus-router.js";
import { GuildSelector } from "../agents/guild-selector.js";
import type { GuildCandidate } from "../agents/guild-selector.js";
import type { SignalFrame } from "./signal-frame.js";
import type { EssenceProfile } from "../agents/essence-profile.js";
import type { ChronicleStore } from "../chronicle/chronicle-store.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Complete diagnostic result from the IFÁ-MAS passive diagnostic pipeline.
 * All 6 fields are present in every diagnostic run.
 */
export type IfamasDiagnostic = {
  signal: SignalFrame;
  offering: OfferingPlan;
  envelope: BridgeEnvelope;
  routeDecision: NexusRouteDecision;
  gatewayValidation: BridgeValidationResult;
  guildCandidates: GuildCandidate[];
};

/* ------------------------------------------------------------------ */
/*  Pipeline                                                           */
/* ------------------------------------------------------------------ */

/**
 * Run the IFÁ-MAS passive diagnostic pipeline end-to-end.
 *
 * Pipeline order:
 *   1. Accept the provided `SignalFrame` as-is
 *   2. `prescribeOffering(input.signal)`                → offering
 *   3. `buildBridgeEnvelope({ signal, offering })`       → envelope
 *   4. `new BridgeGateway().validateEnvelope(envelope)`  → gatewayValidation
 *   5. `routeViaNexus({ envelope, chronicleStore })`      → routeDecision
 *   6. Guild selection (only if candidates provided)     → guildCandidates
 *   7. Return `IfamasDiagnostic` with all fields
 *
 * @param input.task              - Optional task label (reserved, not used yet)
 * @param input.signal            - The signal frame to diagnose
 * @param input.candidates        - Optional array of EssenceProfiles for guild selection
 * @param input.chronicleStore    - Optional ChronicleStore for route enrichment
 * @returns A complete diagnostic result
 */
export async function runIfamasDiagnostic(input: {
  task?: string;
  signal: SignalFrame;
  candidates?: EssenceProfile[];
  chronicleStore?: ChronicleStore;
}): Promise<IfamasDiagnostic> {
  const { signal, chronicleStore } = input;

  // Step 2: Prescribe offering from the signal
  const offering: OfferingPlan = prescribeOffering(signal);

  // Step 3: Build bridge envelope from signal and offering
  const envelope: BridgeEnvelope = buildBridgeEnvelope({ signal, offering });

  // Step 4: Validate the envelope through the bridge gateway
  const gateway = new BridgeGateway();
  const gatewayValidation: BridgeValidationResult = gateway.validateEnvelope(envelope);

  // Step 5: Route the envelope through the nexus router
  const routeDecision: NexusRouteDecision = await routeViaNexus({
    envelope,
    chronicleStore,
  });

  // Step 6: Guild selection (only if candidates are provided)
  let guildCandidates: GuildCandidate[] = [];
  if (input.candidates && input.candidates.length > 0) {
    const selector = new GuildSelector();
    guildCandidates = selector.select({ envelope, candidates: input.candidates });
  }

  // Step 7: Return complete diagnostic
  return {
    signal,
    offering,
    envelope,
    routeDecision,
    gatewayValidation,
    guildCandidates,
  };
}
