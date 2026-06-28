export interface ModelRoutingCase {
  id: string;
  prompt: string;
  expectedDomain: 'coding' | 'research' | 'infra' | 'docs' | 'business' | 'personal' | 'unsafe';
  expectedIntent: string;
  expectedRisk: 'low' | 'medium' | 'high' | 'critical';
}

export interface ModelRoutingResult {
  caseId: string;
  model: string;
  validJson: boolean;
  domainCorrect: boolean;
  intentCorrect: boolean;
  riskCorrect: boolean;
  rawOutput: string;
}

export function summarizeRoutingResults(results: ModelRoutingResult[]) {
  const total = results.length || 1;
  return {
    total: results.length,
    validJsonRate: results.filter(r => r.validJson).length / total,
    domainAccuracy: results.filter(r => r.domainCorrect).length / total,
    intentAccuracy: results.filter(r => r.intentCorrect).length / total,
    riskAccuracy: results.filter(r => r.riskCorrect).length / total,
    passedFastTierThreshold: results.filter(r => r.validJson).length / total >= 0.95 && results.filter(r => r.domainCorrect && r.intentCorrect).length / total >= 0.90,
  };
}
