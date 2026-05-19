export type CostRecord = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type CostProfileMap = Record<string, { inputPerMillion: number; outputPerMillion: number }>;

export type CostSummary = {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  requests: number;
  byModel: Record<string, { tokens: number; costUSD: number }>;
};

export class CostTracker {
  private records: CostRecord[] = [];
  private _sessionId: string;
  private profiles: CostProfileMap;

  constructor(profiles: CostProfileMap = {}) {
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.profiles = profiles;
  }

  record(usage: { provider: string; model: string; inputTokens: number; outputTokens: number }): void {
    this.records.push({
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }

  summary(): CostSummary {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    const byModel: Record<string, { tokens: number; costUSD: number }> = {};

    for (const rec of this.records) {
      totalInput += rec.inputTokens;
      totalOutput += rec.outputTokens;

      const profileKey = `${rec.provider}/${rec.model}`;
      const profile = this.profiles[profileKey];
      let cost = 0;
      if (profile) {
        cost = (rec.inputTokens / 1_000_000) * profile.inputPerMillion +
               (rec.outputTokens / 1_000_000) * profile.outputPerMillion;
        totalCost += cost;
      }

      if (!byModel[profileKey]) {
        byModel[profileKey] = { tokens: 0, costUSD: 0 };
      }
      byModel[profileKey].tokens += rec.inputTokens + rec.outputTokens;
      byModel[profileKey].costUSD += cost;
    }

    return {
      sessionId: this._sessionId,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUSD: Math.round(totalCost * 1000) / 1000,
      requests: this.records.length,
      byModel,
    };
  }

  get sessionId(): string {
    return this._sessionId;
  }
}