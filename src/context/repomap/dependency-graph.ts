import { dirname, join, normalize } from "node:path";

export type DependencyInputFile = {
  path: string;
  content?: string;
};

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']|export\s+[^"']*from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export interface DependencyGraph {
  dependenciesOf(path: string): string[];
  dependentsOf(path: string): string[];
  transitiveDependenciesOf(path: string, maxDepth?: number): string[];
  findCycles(): string[][];
  impactScore(path: string): number;
  readonly files: string[];
}

function normalizePath(path: string): string {
  return normalize(path).replace(/\\/g, "/");
}

function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  const base = normalizePath(join(dirname(fromPath), specifier));
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

class DependencyGraphImpl implements DependencyGraph {
  private dependencies: Map<string, Set<string>>;
  private dependents: Map<string, Set<string>>;
  private _files: string[];

  constructor(files: DependencyInputFile[]) {
    const knownPaths = new Set(files.map((file) => normalizePath(file.path)));
    this.dependencies = new Map();
    this.dependents = new Map();
    this._files = [];

    for (const file of files) {
      const from = normalizePath(file.path);
      this._files.push(from);
      const imports = extractImportSpecifiers(file.content ?? "");
      for (const specifier of imports) {
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelativeImport(from, specifier, knownPaths);
        if (!resolved) continue;
        this.addEdge(this.dependencies, from, resolved);
        this.addEdge(this.dependents, resolved, from);
      }
    }
  }

  get files(): string[] {
    return [...this._files];
  }

  dependenciesOf(path: string): string[] {
    return [...(this.dependencies.get(normalizePath(path)) ?? [])].sort();
  }

  dependentsOf(path: string): string[] {
    return [...(this.dependents.get(normalizePath(path)) ?? [])].sort();
  }

  transitiveDependenciesOf(file: string, maxDepth = 10): string[] {
    const visited = new Set<string>();
    const queue: { file: string; depth: number }[] = [{ file, depth: 0 }];

    while (queue.length > 0) {
      const { file: current, depth } = queue.shift()!;
      if (visited.has(current) || depth > maxDepth) continue;
      visited.add(current);

      const deps = this.dependenciesOf(current);
      for (const dep of deps) {
        if (!visited.has(dep)) {
          queue.push({ file: dep, depth: depth + 1 });
        }
      }
    }

    visited.delete(normalizePath(file));
    return [...visited];
  }

  findCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (node: string): void => {
      if (stack.includes(node)) {
        const cycleStartIndex = stack.indexOf(node);
        const cycle = [...stack.slice(cycleStartIndex), node];
        cycles.push(cycle);
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.push(node);

      for (const dep of this.dependenciesOf(node)) {
        dfs(dep);
      }

      stack.pop();
    };

    for (const file of this._files) {
      dfs(file);
    }

    return cycles;
  }

  impactScore(file: string): number {
    const directDependents = this.dependentsOf(file).length;
    const transitiveDependents = this.transitiveDependenciesOf(file, 5).length;
    return directDependents + (transitiveDependents * 0.5);
  }

  private addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
    const set = map.get(from) ?? new Set<string>();
    set.add(to);
    map.set(from, set);
  }
}

export function buildDependencyGraph(files: DependencyInputFile[]): DependencyGraph {
  return new DependencyGraphImpl(files);
}