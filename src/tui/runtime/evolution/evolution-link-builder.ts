/** Q-S4 — reference-by-id evolution link index. Links are projection metadata
 *  (association), NEVER domain state; direction carries no causality;
 *  many-to-many preserved; no primary. NO forecast→measurement edge is ever
 *  emitted without an A9Correlation (the correlation is the bridge). */
import type { A9Correlation, A9Forecast } from '../../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../../evolution/verification/contracts/recommendation-contract.js';
import { recommendationKindToDecisionKind } from '../../../evolution/governance/decision-engine.js';
import type { EvolutionLink } from './evolution-projection-snapshot.js';

export interface BuildEvolutionLinksArgs {
  readonly forecasts: ReadonlyArray<A9Forecast>;
  readonly recommendations: ReadonlyArray<GovernanceRecommendation>;
  readonly measurements: ReadonlyArray<{ readonly measurementId: string; readonly capabilityId: string }>;
  readonly correlations: ReadonlyArray<A9Correlation>;
  /** proposalId → target capabilityId (derived from relayed
   *  proposal.submitted payloads; canonical two-hop bridge). */
  readonly proposalTargets: Readonly<Record<string, string>>;
}

export function buildEvolutionLinks(args: BuildEvolutionLinksArgs): readonly EvolutionLink[] {
  const links: EvolutionLink[] = [];
  const { forecasts, recommendations, measurements, correlations, proposalTargets } = args;

  // forecast→recommendation (shared proposalId; many-to-many).
  for (const f of forecasts) {
    for (const r of recommendations) {
      if (r.proposalId !== f.subject) continue;
      links.push({ from: f.forecastId, fromType: 'forecast', to: r.recommendationId, toType: 'recommendation', kind: 'forecast→recommendation' });
    }
  }

  // recommendation→decision (PROJECTED — keyed by the canonical recommendationId).
  for (const r of recommendations) {
    if (!recommendationKindToDecisionKind(r.kind)) continue;
    links.push({ from: r.recommendationId, fromType: 'recommendation', to: r.recommendationId, toType: 'decision', kind: 'recommendation→decision' });
  }

  // decision→measurement (recommendation's proposal target capability ↔ measurements).
  for (const r of recommendations) {
    if (!recommendationKindToDecisionKind(r.kind)) continue;
    const target = proposalTargets[r.proposalId];
    if (!target) continue;
    for (const m of measurements) {
      if (m.capabilityId !== target) continue;
      links.push({ from: r.recommendationId, fromType: 'decision', to: m.measurementId, toType: 'measurement', kind: 'decision→measurement' });
    }
  }

  // correlations are the ONLY bridge between forecasts and measurements.
  for (const c of correlations) {
    links.push({ from: c.forecastId, fromType: 'forecast', to: c.correlationId, toType: 'correlation', kind: 'forecast→correlation' });
    links.push({ from: c.measurementId, fromType: 'measurement', to: c.correlationId, toType: 'correlation', kind: 'measurement→correlation' });
  }

  return links;
}
