/**
 * cost-panel.ts — P4.2h TUI panel for cost and token usage display.
 *
 * Renders cost/usage data from CostAttribution and MetricsStore as
 * a formatted TUI panel with provider and workflow breakdowns.
 */

export interface CostPanelData {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number; calls: number; latencyMs: number }>;
  byWorkflow: Record<string, { tokens: number; cost: number; calls: number }>;
  unknownPricingModels: string[];
}

/**
 * Format cost/usage data into TUI panel lines.
 */
export function formatCostPanel(data: CostPanelData, _width?: number): string[] {
  const lines: string[] = [];
  lines.push(`── Cost & Tokens ─────────────────────────`);
  lines.push(` Total tokens: ${data.totalTokens.toLocaleString()}`);
  lines.push(` Total cost:   ${data.totalCost >= 0 ? `$${data.totalCost.toFixed(4)}` : "unknown"}`);
  if (data.unknownPricingModels.length > 0) {
    lines.push(` ⚠ ${data.unknownPricingModels.length} model(s) with unknown pricing`);
  }
  lines.push("");

  lines.push(` By Provider:`);
  for (const [name, p] of Object.entries(data.byProvider)) {
    const costStr = p.cost >= 0 ? `$${p.cost.toFixed(4)}` : "?";
    const avgLatency = p.calls > 0 ? Math.round(p.latencyMs / p.calls) : 0;
    lines.push(`   ${name.padEnd(12)} tokens:${String(p.tokens).padStart(8)} cost:${costStr} calls:${p.calls} avg:${avgLatency}ms`);
  }
  lines.push("");

  lines.push(` By Workflow (top 5):`);
  const sorted = Object.entries(data.byWorkflow)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 5);
  for (const [name, w] of sorted) {
    const costStr = w.cost >= 0 ? `$${w.cost.toFixed(4)}` : "?";
    lines.push(`   ${name.slice(0, 30).padEnd(32)} tokens:${String(w.tokens).padStart(8)} cost:${costStr}`);
  }

  if (sorted.length === 0) {
    lines.push(`   (no usage data available)`);
  }

  return lines;
}
