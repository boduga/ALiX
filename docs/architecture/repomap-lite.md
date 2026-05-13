# RepoMapLite

## Purpose

RepoMapLite gives the planner enough repository context to avoid blind planning in MVP. It is intentionally simpler than the future full repo map.

## Design Goals

- Cheap to build.
- Works without language servers.
- Works outside git, but uses git when available.
- Produces useful context before the first model plan.
- Feeds the event log and UI.

## Inputs

- Workspace root.
- User request.
- Project config.
- Optional pinned files.
- Git status if available.

## Outputs

```ts
type RepoMapLite = {
  root: string;
  generatedAt: string;
  files: RepoFileSummary[];
  configFiles: string[];
  docsFiles: string[];
  testFiles: string[];
  sourceFiles: string[];
  topLevelSymbols: SymbolSummary[];
  git?: GitSummary;
};

type RepoFileSummary = {
  path: string;
  kind: "source" | "test" | "config" | "docs" | "asset" | "unknown";
  language?: string;
  sizeBytes: number;
  lineCount?: number;
};

type SymbolSummary = {
  path: string;
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  line?: number;
};

type GitSummary = {
  branch?: string;
  changedFiles: string[];
  untrackedFiles: string[];
};
```

## File Discovery

Use `rg --files` when available.

Ignore:

- `.git/**`
- `node_modules/**`
- `vendor/**`
- `dist/**`
- `build/**`
- `.next/**`
- `coverage/**`
- binary files
- configured ignore patterns

## Classification

Config files:

- `package.json`
- `tsconfig.json`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- `Makefile`
- CI config
- Docker files

Docs files:

- `README*`
- `AGENTS.md`
- `CLAUDE.md`
- `HARNESS.md`
- `docs/**`

Test files:

- `*.test.*`
- `*.spec.*`
- `test/**`
- `tests/**`
- `__tests__/**`

Source files:

- Common code extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.cs`, `.rb`, `.php`, `.swift`, `.c`, `.cpp`, `.h`, `.hpp`.

## Top-Level Symbol Extraction

MVP uses regex-based extraction only.

Examples:

- TypeScript/JavaScript: `function`, `class`, `interface`, `type`, exported `const`.
- Python: `def`, `class`.
- Go: `func`, `type`.
- Rust: `fn`, `struct`, `enum`, `trait`.

Tree-sitter comes later in the full repo map.

## Ranking

RepoMapLite ranks files for the initial context bundle using:

- Direct path mention in user request.
- Symbol name mention in user request.
- File basename mention.
- Config/docs priority.
- Git modified/untracked status.
- Test relationship to mentioned source file.

```ts
type RankedRepoItem = {
  path: string;
  score: number;
  reasons: string[];
};
```

## Event Emission

RepoMapLite emits:

- `context.repo_map_lite_started`
- `context.repo_map_lite_created`
- `context.repo_map_lite_failed`

The created event includes counts and top ranked files, not the full map. The full map is stored as an artifact if large.

## MVP Acceptance Tests

- In a repo with `package.json`, it appears in `configFiles`.
- In a repo with `src/foo.ts` and `src/foo.test.ts`, the test relationship is detected.
- A user request mentioning `foo.ts` ranks `src/foo.ts` first.
- Modified git files receive a ranking boost when git is available.
- Ignored directories such as `node_modules` are absent from the map.
- RepoMapLite runs successfully outside a git repo.
