/**
 * collaboration-budget-allocator.ts — Typed budget allocation with invariant enforcement.
 *
 * Reserves system/task budget. Explicitly selects dependency results (compressing
 * oversized). Filters findings by minimumScore, ranks, allocates up to bucket and
 * global caps. Deduplicates by ID. Records accurate omission counts.
 */

import { DEFAULT_CONTEXT_BUDGET, type ContextBudget, type BudgetAllocationResult, type OmittedByReason, type SelectedItem } from "./collaboration-relevance-types.js";
import type { RelevanceScore } from "./collaboration-relevance-types.js";
import type { SharedFinding, SharedArtifact } from "./collaboration-types.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class BudgetAllocator {
  constructor(private budget: ContextBudget = DEFAULT_CONTEXT_BUDGET) {}

  allocate(
    results: Array<{ ref: string; sourceWorkerId: string; outcome: string; estimatedTokens: number }>,
    scored: Array<{ finding: SharedFinding; score: RelevanceScore }>,
    artifacts: SharedArtifact[],
  ): BudgetAllocationResult {
    let available = this.budget.totalTokens - this.budget.systemReserveTokens - this.budget.taskReserveTokens;
    const omittedByReason: OmittedByReason = { budget: 0, lowRelevance: 0, invalidated: 0, superseded: 0, staleAttempt: 0, staleDependency: 0, staleArtifact: 0, unauthorized: 0, duplicate: 0, semanticRerankLimit: 0 };
    let tokenEstimate = 0;

    // 1. Select dependency results
    const seenResultRefs = new Set<string>();
    const selectedResults: SelectedItem[] = [];
    for (const r of results) {
      if (selectedResults.length >= this.budget.dependencyResults.maxItems) break;
      if (seenResultRefs.has(r.ref)) { omittedByReason.duplicate++; continue; }
      seenResultRefs.add(r.ref);
      const tokens = Math.min(r.estimatedTokens, this.budget.dependencyResults.maxTokens - selectedResults.reduce((s, x) => s + x.includedTokens, 0));
      if (tokens > available) { omittedByReason.budget++; continue; }
      selectedResults.push({
        id: r.ref, estimatedTokens: r.estimatedTokens, includedTokens: tokens,
        score: 0, scoreComponents: {}, selectionReasons: ["direct_dependency_result"],
      });
      tokenEstimate += tokens;
      available -= tokens;
    }

    // 2. Rank and allocate findings
    const seenFindingIds = new Set<string>();
    const selectedFindings: SelectedItem[] = [];
    const ranked = [...scored].sort((a, b) => b.score.total - a.score.total);
    for (const { finding, score } of ranked) {
      if (selectedFindings.length >= this.budget.findings.maxItems) { omittedByReason.budget++; continue; }
      if (score.total < this.budget.findings.minimumScore) { omittedByReason.lowRelevance++; continue; }
      if (seenFindingIds.has(finding.id)) { omittedByReason.duplicate++; continue; }
      seenFindingIds.add(finding.id);
      const tokens = estimateTokens(finding.title + finding.content);
      if (tokenEstimate + tokens > this.budget.findings.maxTokens || tokens > available) { omittedByReason.budget++; continue; }
      selectedFindings.push({
        id: finding.id, estimatedTokens: tokens, includedTokens: tokens,
        score: score.total, scoreComponents: score.components, selectionReasons: score.reasons,
      });
      tokenEstimate += tokens;
      available -= tokens;
    }

    // 3. Allocate artifacts
    const seenArtifactIds = new Set<string>();
    const selectedArtifacts: SelectedItem[] = [];
    for (const a of artifacts) {
      if (selectedArtifacts.length >= this.budget.artifacts.maxItems) { omittedByReason.budget++; continue; }
      if (seenArtifactIds.has(a.id)) { omittedByReason.duplicate++; continue; }
      seenArtifactIds.add(a.id);
      const tokens = estimateTokens(a.uri);
      if (tokens > available) { omittedByReason.budget++; continue; }
      selectedArtifacts.push({
        id: a.id, estimatedTokens: tokens, includedTokens: tokens,
        score: 0, scoreComponents: {}, selectionReasons: ["referenced_artifact"],
      });
      tokenEstimate += tokens;
      available -= tokens;
    }

    return {
      selectedResults, selectedFindings, selectedArtifacts, tokenEstimate,
      bucketUsage: {
        dependencyResults: selectedResults.reduce((s, x) => s + x.includedTokens, 0),
        findings: selectedFindings.reduce((s, x) => s + x.includedTokens, 0),
        artifacts: selectedArtifacts.reduce((s, x) => s + x.includedTokens, 0),
        reserves: this.budget.systemReserveTokens + this.budget.taskReserveTokens,
        total: tokenEstimate + this.budget.systemReserveTokens + this.budget.taskReserveTokens,
      },
      omittedByReason,
    };
  }
}
