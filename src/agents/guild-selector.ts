import {
  checkEssenceCompatibility,
  type EssenceProfile,
} from "./essence-profile.js";
import type { BridgeEnvelope } from "../runtime/bridge-envelope.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GuildCandidate = {
  profile: EssenceProfile;
  score: number;
  compatible: boolean;
  reasons: string[];
};

/* ------------------------------------------------------------------ */
/*  GuildSelector                                                      */
/* ------------------------------------------------------------------ */

/**
 * Select specialist agents (EssenceProfiles) based on compatibility with
 * a BridgeEnvelope.
 *
 * This is a passive coordination module — it returns a ranked list of
 * candidates for the ALiX runtime to consider, without executing anything.
 *
 * Completes the passive coordination loop:
 *   SignalFrame -> OfferingPlan -> BridgeEnvelope -> NexusRouter
 *     -> BridgeGateway -> GuildSelector
 */
export class GuildSelector {
  /**
   * Rank candidate EssenceProfiles by compatibility with a BridgeEnvelope.
   * Uses checkEssenceCompatibility() for each candidate.
   * Returns candidates sorted by score descending, with compatible=true first.
   */
  select(input: {
    envelope: BridgeEnvelope;
    candidates: EssenceProfile[];
  }): GuildCandidate[] {
    const { envelope, candidates } = input;

    if (candidates.length === 0) return [];

    const results: GuildCandidate[] = candidates.map((profile) => {
      const compatibility = checkEssenceCompatibility(
        profile,
        envelope.signal,
        envelope.offering,
      );
      return {
        profile,
        score: compatibility.score,
        compatible: compatibility.compatible,
        reasons: compatibility.reasons,
      };
    });

    // Stable sort: compatible=true first, then by score descending
    results.sort((a, b) => {
      if (a.compatible !== b.compatible) {
        return a.compatible ? -1 : 1;
      }
      return b.score - a.score;
    });

    return results;
  }
}
