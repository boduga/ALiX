import { promises as fs } from "node:fs";
import path from "node:path";

export type SymbolKind = "function" | "class" | "method" | "interface" | "type" | "const";

export type IndexedSymbol = {
  path: string;
  symbolName: string;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
  keywords: string[];
};

export type SearchResult = IndexedSymbol & {
  score: number;
};

type IndexEntry = {
  symbols: IndexedSymbol[];
};

export class SemanticSearchIndex {
  private baseDir: string;
  private indexPath: string;
  private index: Map<string, IndexEntry> = new Map();

  constructor(baseDir: string, indexPath?: string) {
    this.baseDir = baseDir;
    this.indexPath = indexPath ?? path.join(baseDir, ".semantic-search-index.json");
  }

  async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.indexPath, "utf-8");
      const parsed = JSON.parse(data);
      this.index = new Map(Object.entries(parsed));
    } catch {
      this.index = new Map();
    }
  }

  async indexFile(filePath: string, content?: string): Promise<void> {
    const fileContent = content ?? await fs.readFile(filePath, "utf-8");
    const relativePath = path.relative(this.baseDir, filePath);
    const symbols = this.parseSymbols(fileContent, relativePath);

    this.index.set(relativePath, { symbols });
    await this.persistIndex();
  }

  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    const results: SearchResult[] = [];

    for (const [filePath, entry] of this.index.entries()) {
      for (const symbol of entry.symbols) {
        const score = this.calculateScore(symbol, queryLower, queryWords);
        if (score > 0) {
          results.push({ ...symbol, score });
        }
      }
    }

    // Sort by score descending, then by symbol name
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.symbolName.localeCompare(b.symbolName);
    });

    return results.slice(0, limit);
  }

  private parseSymbols(content: string, filePath: string): IndexedSymbol[] {
    const symbols: IndexedSymbol[] = [];
    const lines = content.split("\n");

    // Track current class context for methods
    let currentClass: string | null = null;
    let currentClassStartLine = 0;

    // Regex patterns for symbol detection
    const patterns = {
      exportFunction: /^export\s+(?:async\s+)?function\s+(\w+)/,
      function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      exportClass: /^export\s+class\s+(\w+)/,
      class: /^class\s+(\w+)/,
      exportInterface: /^export\s+interface\s+(\w+)/,
      interface: /^interface\s+(\w+)/,
      exportType: /^export\s+type\s+(\w+)/,
      type: /^type\s+(\w+)/,
      exportConst: /^export\s+const\s+(\w+)/,
      const: /^const\s+(\w+)/,
      method: /^\s+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)(?::\s*[^{]+)?\{/,
      comment: /^\s*\/\*/,
    };

    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Handle block comments
      if (line.includes("/*")) inBlockComment = true;
      if (line.includes("*/")) {
        inBlockComment = false;
        continue;
      }
      if (inBlockComment) continue;

      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("//")) continue;

      // Extract keywords from comments above
      const keywords = this.extractKeywordsFromContext(lines, i);

      // Class definition
      let match = line.match(patterns.exportClass) || line.match(patterns.class);
      if (match) {
        currentClass = match[1];
        currentClassStartLine = lineNum;
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "class",
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          keywords,
        });
        continue;
      }

      // Interface
      match = line.match(patterns.exportInterface) || line.match(patterns.interface);
      if (match) {
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "interface",
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          keywords,
        });
        continue;
      }

      // Type alias
      match = line.match(patterns.exportType) || line.match(patterns.type);
      if (match && !line.includes("{")) {
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "type",
          lineStart: lineNum,
          lineEnd: lineNum,
          keywords,
        });
        continue;
      }

      // Export function
      match = line.match(patterns.exportFunction);
      if (match) {
        currentClass = null; // Reset class context for top-level functions
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "function",
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          keywords,
        });
        continue;
      }

      // Non-export function
      match = line.match(patterns.function);
      if (match) {
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "function",
          lineStart: lineNum,
          lineEnd: this.findBlockEnd(lines, i),
          keywords,
        });
        continue;
      }

      // Const
      match = line.match(patterns.exportConst) || line.match(patterns.const);
      if (match) {
        symbols.push({
          path: filePath,
          symbolName: match[1],
          kind: "const",
          lineStart: lineNum,
          lineEnd: lineNum,
          keywords,
        });
        continue;
      }

      // Method inside a class
      if (currentClass) {
        match = line.match(patterns.method);
        if (match) {
          symbols.push({
            path: filePath,
            symbolName: match[1],
            kind: "method",
            lineStart: lineNum,
            lineEnd: this.findBlockEnd(lines, i),
            keywords: [],
          });
        }
      }
    }

    return symbols;
  }

  private extractKeywordsFromContext(lines: string[], currentIndex: number): string[] {
    const keywords: string[] = [];
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
      "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
      "did", "will", "would", "should", "could", "may", "might", "can", "this", "that",
      "these", "those", "it", "its", "return", "throws", "export", "import", "from", "async",
    ]);

    // Look back up to 5 lines for comments
    for (let i = Math.max(0, currentIndex - 5); i < currentIndex; i++) {
      const line = lines[i];
      if (line.trim().startsWith("//")) {
        const commentText = line.replace(/^\s*\/\/\s*/, "").toLowerCase();
        const words = commentText.split(/\s+/);
        for (const word of words) {
          const cleaned = word.replace(/[^a-zA-Z]/g, "");
          if (cleaned.length > 2 && !stopWords.has(cleaned)) {
            keywords.push(cleaned);
          }
        }
      }
    }

    return [...new Set(keywords)];
  }

  private findBlockEnd(lines: string[], startIndex: number): number {
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === "{") {
          braceCount++;
          started = true;
        } else if (char === "}") {
          braceCount--;
          if (started && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }
    return startIndex + 1;
  }

  private calculateScore(symbol: IndexedSymbol, queryLower: string, queryWords: string[]): number {
    const nameLower = symbol.symbolName.toLowerCase();
    let score = 0;

    // Exact match
    if (nameLower === queryLower) {
      score += 100;
    }
    // Starts with query
    else if (nameLower.startsWith(queryLower)) {
      score += 50;
    }
    // Contains query
    else if (nameLower.includes(queryLower)) {
      score += 25;
    }
    // Word match
    else {
      for (const word of queryWords) {
        if (nameLower === word) {
          score += 100;
        } else if (nameLower.startsWith(word)) {
          score += 50;
        } else if (nameLower.includes(word)) {
          score += 25;
        }
      }
    }

    // Boost for keyword matches
    for (const keyword of symbol.keywords) {
      const keywordLower = keyword.toLowerCase();
      if (queryWords.some(q => keywordLower.includes(q) || q.includes(keywordLower))) {
        score += 10;
      }
    }

    // Boost for shorter names (usually more specific) - only if there's a match
    if (score > 0 && symbol.symbolName.length < queryLower.length * 2) {
      score += 5;
    }

    return score;
  }

  private async persistIndex(): Promise<void> {
    const obj = Object.fromEntries(this.index);
    await fs.writeFile(this.indexPath, JSON.stringify(obj, null, 2));
  }
}