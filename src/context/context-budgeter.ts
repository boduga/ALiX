export type TokenEstimate = {
  path: string;
  tokens: number;
  pinned?: boolean;
};

export type BudgetInput = {
  primaryFiles?: number;
  supportingFiles?: number;
  tests?: number;
  history?: number;
  pinned?: TokenEstimate[];
};

export type BudgetResult = {
  totalTokens: number;
  maxTokens: number;
  remainingTokens: number;
  exceeded: boolean;
  overflow: number;
  pinnedTokens: number;
  trimmed: string[];
};

export class ContextBudgeter {
  private maxTokens: number;
  private reservedTokens: number;

  constructor(options: { maxTokens: number; reservedTokens?: number }) {
    this.maxTokens = options.maxTokens;
    this.reservedTokens = options.reservedTokens ?? 0;
  }

  calculate(input: BudgetInput): BudgetResult {
    const effectiveMax = this.maxTokens - this.reservedTokens;

    // Calculate pinned tokens first (these are always kept)
    const pinnedTokens = input.pinned?.reduce((sum, p) => sum + p.tokens, 0) ?? 0;

    // Calculate regular tokens
    const regularTokens = (input.primaryFiles ?? 0) +
      (input.supportingFiles ?? 0) +
      (input.tests ?? 0) +
      (input.history ?? 0);

    const totalTokens = pinnedTokens + regularTokens;
    const exceeded = totalTokens > effectiveMax;
    const overflow = exceeded ? totalTokens - effectiveMax : 0;
    const remainingTokens = exceeded ? 0 : effectiveMax - totalTokens;

    // Determine which files would be trimmed (non-pinned that exceed budget)
    const trimmed: string[] = [];
    if (exceeded) {
      // Trim supporting files first, then tests, then history, then primary files
      const sources: { type: string; tokens: number; paths?: string[] }[] = [
        { type: 'supporting', tokens: input.supportingFiles ?? 0 },
        { type: 'tests', tokens: input.tests ?? 0 },
        { type: 'history', tokens: input.history ?? 0 },
        { type: 'primary', tokens: input.primaryFiles ?? 0 }
      ];

      let remainingOverflow = overflow;
      for (const source of sources) {
        if (remainingOverflow <= 0) break;
        if (source.tokens > 0) {
          trimmed.push(source.type);
          remainingOverflow -= source.tokens;
        }
      }
    }

    return {
      totalTokens,
      maxTokens: effectiveMax,
      remainingTokens,
      exceeded,
      overflow,
      pinnedTokens,
      trimmed
    };
  }

  formatSummary(result: BudgetResult): string {
    const parts: string[] = [
      `Tokens: ${result.totalTokens}/${result.maxTokens}`,
      `Pinned: ${result.pinnedTokens}`
    ];

    if (result.exceeded) {
      parts.push(`EXCEEDED by ${result.overflow}`);
    } else {
      parts.push(`Remaining: ${result.remainingTokens}`);
    }

    if (result.trimmed.length > 0) {
      parts.push(`Trimmed: ${result.trimmed.join(', ')}`);
    }

    return parts.join(' | ');
  }
}