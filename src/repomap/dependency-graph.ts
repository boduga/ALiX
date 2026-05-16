import { dirname, join, normalize } from "node:path";

export type DependencyInputFile = {
  path: string;
  content?: string;
};

export type DependencyGraph = {
  dependenciesOf(path: string): string[];
  dependentsOf(path: string): string[];
};

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']|export\s+[^"']*from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export function buildDependencyGraph(files: DependencyInputFile[]): DependencyGraph {
  const knownPaths = new Set(files.map((file) => normalizePath(file.path)));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const file of files) {
    const from = normalizePath(file.path);
    const imports = extractImportSpecifiers(file.content ?? "");
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(from, specifier, knownPaths);
      if (!resolved) continue;
      addEdge(dependencies, from, resolved);
      addEdge(dependents, resolved, from);
    }
  }

  return {
    dependenciesOf(path: string) {
      return [...(dependencies.get(normalizePath(path)) ?? [])].sort();
    },
    dependentsOf(path: string) {
      return [...(dependents.get(normalizePath(path)) ?? [])].sort();
    },
  };
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

function addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
  const set = map.get(from) ?? new Set<string>();
  set.add(to);
  map.set(from, set);
}

function normalizePath(path: string): string {
  return normalize(path).replace(/\\/g, "/");
}