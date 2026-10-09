/**
 * Advisory IFÁ-MAS context attached to approval requests.
 * Display-only — never used in PolicyGate decisions.
 */
export type IfamasApprovalContext = {
  signalCode: string;
  signalPolarity: string;
  offeringAction: string;
  routeTarget?: string;
  gatewayValid: boolean;
  topGuildCandidate?: string;
  chronicleRefCount: number;
};

export type IfamasTracePanel = {
  signalCode: string;
  polarity: string;
  offeringAction: string;
  routeTarget?: string;
  gatewayValid: boolean;
  guildCandidateCount: number;
  topGuildCandidate?: string;
  chronicleRefCount: number;
};

export function formatIfamasPanel(panel: IfamasTracePanel): string[] {
  const lines: string[] = [];
  lines.push("── IFÁ-MAS Diagnostic ─────────────────");
  lines.push(`Signal:   ${panel.polarity.toUpperCase()}  ${panel.signalCode}`);
  lines.push(`Offering: ${panel.offeringAction}`);
  lines.push(`Route:    ${panel.routeTarget ?? "—"}`);
  lines.push(`Gateway:  ${panel.gatewayValid ? "✓ valid" : "✗ invalid"}`);
  lines.push(`Guild:    ${panel.guildCandidateCount} candidate(s)`);
  if (panel.topGuildCandidate) {
    lines.push(`  Top:    ${panel.topGuildCandidate}`);
  }
  if (panel.chronicleRefCount > 0) {
    lines.push(`Chronicle: ${panel.chronicleRefCount} past case(s) found`);
  }
  return lines;
}
