import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export class DependencyGraph {
  private imports = new Map<string, string[]>();
  private reverseImports = new Map<string, string[]>();

  addImport(from: string, to: string): void {
    if (!this.imports.has(from)) this.imports.set(from, []);
    this.imports.get(from)!.push(to);

    if (!this.reverseImports.has(to)) this.reverseImports.set(to, []);
    this.reverseImports.get(to)!.push(from);
  }

  depsOf(file: string): string[] {
    return this.imports.get(file) ?? [];
  }

  dependentsOf(file: string): string[] {
    return this.reverseImports.get(file) ?? [];
  }

  /**
   * Find test files that might be affected by changes to given source files.
   * Goes up the dependency chain: if A imports B, and B changes, A's tests may break.
   */
  findAffectedTests(sourceFiles: string[]): string[] {
    const testFiles = new Set<string>();

    // For each changed source, find all files that depend on it (transitively)
    const visited = new Set<string>();
    const queue = [...sourceFiles];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const dependents = this.dependentsOf(current);
      for (const dep of dependents) {
        if (this.isTestFile(dep)) {
          testFiles.add(dep);
        } else {
          queue.push(dep);
        }
      }
    }

    return [...testFiles];
  }

  private isTestFile(path: string): boolean {
    return /\.test\.ts$|\.spec\.ts$/i.test(path);
  }
}

const IMPORT_PATTERN = /(?:import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(content: string): string[] {
  const imports: string[] = [];
  let match;
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    // Match group 1 = ES import, group 2 = require, group 3 = dynamic import
    const imp = match[1] || match[2] || match[3];
    if (imp) imports.push(imp);
  }
  return imports;
}

function resolveImport(basePath: string, importPath: string): string {
  // Simple relative path resolution
  if (importPath.startsWith(".")) {
    // Get directory of the importing file
    const lastSlash = basePath.lastIndexOf("/");
    const baseDir = lastSlash === -1 ? "" : basePath.substring(0, lastSlash + 1);
    let resolved = baseDir + importPath;
    // Normalize .. segments
    const segments = resolved.split("/");
    const normalized: string[] = [];
    for (const seg of segments) {
      if (seg === "..") {
        normalized.pop();
      } else if (seg !== "." && seg !== "") {
        normalized.push(seg);
      }
    }
    resolved = normalized.join("/");
    // Normalize .js to .ts (TypeScript uses .js extensions in imports)
    resolved = resolved.replace(/\.js$/, ".ts");
    return resolved;
  }
  return importPath;
}

export async function buildDepGraphFromImports(
  root: string,
  filePaths: string[]
): Promise<DependencyGraph> {
  const graph = new DependencyGraph();

  for (const filePath of filePaths) {
    const fullPath = join(root, filePath);
    if (!existsSync(fullPath)) continue;

    const content = await readFile(fullPath, "utf8");
    const imports = extractImports(content);

    for (const imp of imports) {
      const resolved = resolveImport(filePath, imp);
      graph.addImport(filePath, resolved);
    }
  }

  return graph;
}