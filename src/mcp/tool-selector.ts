import type { DeferredToolEntry } from "./tool-deferral.js";

const SAFE_FALLBACK_NAMES = ["filesystem_read", "fetch_get", "files_read", "http_request"];

export type ToolSelectorOptions = {
  maxTools: number;
  tokenBudget: number;
};

// Floor estimate — individual tools may exceed this for complex schemas.
const MIN_TOKENS_PER_TOOL = 25;

export class ToolSelector {
  constructor(
    private tools: DeferredToolEntry[],
    private options: ToolSelectorOptions
  ) {}

  select(taskDescription: string): DeferredToolEntry[] {
    const { maxTools, tokenBudget } = this.options;
    const maxByBudget = Math.floor(tokenBudget / MIN_TOKENS_PER_TOOL);
    const effectiveMax = Math.min(maxTools, maxByBudget, this.tools.length);

    if (effectiveMax >= this.tools.length) return [...this.tools];

    const taskWords = new Set(
      taskDescription.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );

    const scored = this.tools.map(tool => {
      const nameParts = tool.name.toLowerCase().split(/[_\.]/);
      const descWords = new Set(
        tool.description.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      );

      let score = 0;
      for (const word of taskWords) {
        if (nameParts.includes(word)) {
          score += 3;
        } else if (tool.name.toLowerCase().includes(word)) {
          score += 1;
        }
        if (descWords.has(word)) score += 1;
      }
      return { tool, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.tool.serverName.localeCompare(b.tool.serverName);
    });

    let result = scored.slice(0, effectiveMax);

    const hasFallback = result.some(t =>
      SAFE_FALLBACK_NAMES.some(fb => t.tool.name.includes(fb))
    );
    if (!hasFallback) {
      // Build index map for O(1) lookup by object reference
      const scoredIndex = new Map(scored.map((s, i) => [s, i]));
      const fallback = scored.find(s =>
        SAFE_FALLBACK_NAMES.some(fb => s.tool.name.includes(fb))
      );
      if (fallback) {
        if (result.length < effectiveMax) {
          result.push(fallback);
        } else {
          // Insert fallback: keep at most effectiveMax items total
          const fallbackIdx = scoredIndex.get(fallback) ?? -1;
          // Replace the last item if fallback is ranked after effectiveMax-1
          if (fallbackIdx >= effectiveMax) {
            if (effectiveMax > 0) {
              result[effectiveMax - 1] = fallback;
            }
          }
        }
      }
    }

    return result.map(s => s.tool);
  }
}