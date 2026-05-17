import type { DeferredToolEntry } from "./tool-deferral.js";

const SAFE_FALLBACKS = ["filesystem.read", "fetch.get", "files.read", "http.request"];

export type ToolSelectorOptions = {
  maxTools: number;
  tokenBudget: number;
};

const TOKENS_PER_TOOL = 25;

export class ToolSelector {
  constructor(
    private tools: DeferredToolEntry[],
    private options: ToolSelectorOptions
  ) {}

  select(taskDescription: string): DeferredToolEntry[] {
    const { maxTools, tokenBudget } = this.options;
    const maxByBudget = Math.floor(tokenBudget / TOKENS_PER_TOOL);
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
        if (nameParts.includes(word)) score += 3;
        else if (tool.name.toLowerCase().includes(word)) score += 1;
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
      SAFE_FALLBACKS.some(fb => t.tool.name.includes(fb.replace(/\./g, "_")))
    );
    if (!hasFallback) {
      const fallback = scored.find(s =>
        SAFE_FALLBACKS.some(fb => s.tool.name.includes(fb.replace(/\./g, "_")))
      );
      if (fallback) {
        if (result.length < effectiveMax) {
          result.push(fallback);
        } else {
          // Insert fallback: keep at most effectiveMax items total
          const fallbackIdx = scored.indexOf(fallback);
          // Replace the last item if fallback is ranked after effectiveMax-1
          if (fallbackIdx >= effectiveMax) {
            result[effectiveMax - 1] = fallback;
          }
        }
      }
    }

    return result.map(s => s.tool);
  }

  count(): number { return this.tools.length; }
}