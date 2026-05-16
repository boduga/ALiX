export type ExtractedSymbolKind = "function" | "class" | "interface" | "type" | "const";

export type ExtractedSymbol = {
  path: string;
  name: string;
  kind: ExtractedSymbolKind;
  line: number;
  signature: string;
};

const SYMBOL_PATTERNS: Array<{ kind: ExtractedSymbolKind; pattern: RegExp }> = [
  { kind: "function", pattern: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "const", pattern: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_$][\w$]*)/ },
];

export function extractTopLevelSymbols(path: string, content: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;
      symbols.push({
        path,
        name: match[1],
        kind,
        line: index + 1,
        signature: line.trim(),
      });
      break;
    }
  });

  return symbols;
}