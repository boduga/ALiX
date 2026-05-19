export type ChangeType = "code" | "test" | "docs" | "config" | "dependency" | "ui" | "schema" | "migration" | "mixed";

export type ChangeClassification = {
  primary: ChangeType;
  secondary: ChangeType[];
  files: string[];
};

const TEST_PATTERNS = [/\.test\.(ts|js|tsx|jsx)$/, /_test\.(ts|js)$/, /spec\.(ts|js)$/];
const DOC_PATTERNS = [/\.md$/, /\.mdx$/, /\.txt$/];
const CONFIG_PATTERNS = [/^package\.json$/, /^tsconfig\.json$/, /^\.eslint/, /^webpack\./, /vite\.config\./];
const DEPENDENCY_PATTERNS = [/^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /^requirements\.txt$/];
const UI_PATTERNS = [/\.css$/, /\.scss$/, /\.less$/, /\.html$/, /\.vue$/, /\.jsx$/];
const SCHEMA_PATTERNS = [/schema/, /types/];
const MIGRATION_PATTERNS = [/migrate/, /migration/, /seed/];

export function classifyChanges(files: string[]): ChangeClassification {
  const types: ChangeType[] = [];

  for (const file of files) {
    const basename = file.split("/").pop() ?? file;
    const ext = basename.split(".").pop() ?? "";

    if (TEST_PATTERNS.some(p => p.test(basename))) {
      types.push("test");
    } else if (DOC_PATTERNS.some(p => p.test(basename))) {
      types.push("docs");
    } else if (CONFIG_PATTERNS.some(p => p.test(basename))) {
      types.push("config");
    } else if (DEPENDENCY_PATTERNS.some(p => p.test(basename))) {
      types.push("dependency");
    } else if (UI_PATTERNS.some(p => p.test(file))) {
      types.push("ui");
    } else if (SCHEMA_PATTERNS.some(p => p.test(file))) {
      types.push("schema");
    } else if (MIGRATION_PATTERNS.some(p => p.test(file))) {
      types.push("migration");
    } else if (["ts", "js", "tsx", "jsx", "py", "go", "rs", "java"].includes(ext)) {
      types.push("code");
    } else {
      types.push("code");
    }
  }

  const unique = [...new Set(types)];
  const primary = unique.length === 1 ? unique[0] : "mixed";

  return {
    primary,
    secondary: unique.filter(t => t !== primary),
    files,
  };
}

export function getSuggestedChecks(classification: ChangeClassification): string[] {
  const checks: string[] = [];

  if (classification.primary === "code" || classification.primary === "test" || classification.primary === "mixed") {
    checks.push("typecheck");
  }
  if (classification.primary === "test" || classification.primary === "code" || classification.primary === "mixed") {
    checks.push("test");
  }
  if (classification.primary === "config" || classification.primary === "dependency") {
    checks.push("build");
  }

  return checks;
}