import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExtractedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const" | "variable";
  file: string;
  path: string;  // Alias for file (used by context-compiler)
  line: number;
  exports: boolean;
}

export class SymbolExtractor {
  private patterns = [
    { kind: "function" as const, regex: /(?:export\s+)?function\s+(\w+)/g },
    { kind: "class" as const, regex: /(?:export\s+)?class\s+(\w+)/g },
    { kind: "interface" as const, regex: /(?:export\s+)?interface\s+(\w+)/g },
    { kind: "type" as const, regex: /(?:export\s+)?type\s+(\w+)/g },
    { kind: "enum" as const, regex: /(?:export\s+)?enum\s+(\w+)/g },
    { kind: "const" as const, regex: /(?:export\s+)?const\s+(\w+)/g },
    { kind: "variable" as const, regex: /(?:let|var)\s+(\w+)/g },
  ];

  async extractFromDir(dir: string): Promise<ExtractedSymbol[]> {
    const symbols: ExtractedSymbol[] = [];
    const files = await this.findFiles(dir, [".ts", ".tsx", ".js", ".jsx"]);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const fileSymbols = this.extractFromCode(content, file);
      symbols.push(...fileSymbols);
    }

    return symbols;
  }

  extractFromCode(code: string, filename: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = code.split("\n");

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const { kind, regex } of this.patterns) {
        regex.lastIndex = 0;
        const match = regex.exec(line);
        if (match) {
          const isExport = line.trim().startsWith("export");
          symbols.push({
            name: match[1],
            kind,
            file: filename,
            path: filename,  // Alias for file
            line: lineNum + 1,
            exports: isExport,
          });
        }
      }
    }

    return symbols;
  }

  private async findFiles(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          files.push(...await this.findFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist, return empty
    }

    return files;
  }
}

/**
 * Standalone function for extracting top-level symbols from code.
 * Used by context-compiler.ts
 */
export function extractTopLevelSymbols(code: string, filename: string): ExtractedSymbol[] {
  const extractor = new SymbolExtractor();
  return extractor.extractFromCode(code, filename);
}
