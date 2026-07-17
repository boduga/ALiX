import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { getDefaultModel } from "../../providers/catalog.js";
import { parseInitArgs, InitArgsError } from "../helpers/init-args.js";
import { resolveInitialProviderAndModel } from "../helpers/provider-selection.js";

const PROJECT_TYPE_FILES: [string, string][] = [
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["setup.py", "Python"],
  ["Makefile", "Generic/C"],
  ["pom.xml", "Java"],
];

export interface InitDependencies {
  cwd: string;
}

export async function runInit(cwd: string, argv: string[] = [], deps?: Partial<InitDependencies>): Promise<void> {
  const {
    cwd: workDir = cwd,
  } = deps ?? {};

  const alixDir = join(workDir, ".alix");
  const gitignorePath = join(workDir, ".gitignore");
  const agentsPath = join(workDir, "AGENTS.md");
  const projectConfigPath = join(alixDir, "config.json");

  // Step 0: Git check (auto-init if not present)
  const isGitRepo = existsSync(join(workDir, ".git"));
  if (!isGitRepo) {
    try {
      execSync("git init --initial-branch=main", { cwd: workDir, stdio: "inherit" });
      console.log("Git initialized");
      const alixIgnore = "\n# ALiX\n.alix/\n";
      if (existsSync(gitignorePath)) {
        const existing = await readFile(gitignorePath, "utf8");
        if (!existing.includes(".alix/")) {
          await appendFile(gitignorePath, alixIgnore);
        }
      } else {
        await writeFile(gitignorePath, alixIgnore.trimStart());
      }
    } catch {
      console.warn("Warning: git init failed, continuing anyway");
    }
  }

  // Step 1: Project type detection
  let projectType = "Generic";
  for (const [file, type] of PROJECT_TYPE_FILES) {
    if (existsSync(join(workDir, file))) {
      projectType = type;
      break;
    }
  }
  console.log(`Detected: ${projectType} project`);

  // ── Parse + resolve provider/model BEFORE writing config ──
  let parsedArgs;
  try {
    parsedArgs = parseInitArgs(argv);
  } catch (err) {
    if (err instanceof InitArgsError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (parsedArgs.help) {
    console.log(`Usage: alix init [--provider <id>] [--model <id>] [--help]

Options:
  --provider <id>   Skip provider selection; use this provider's API key.
  --model <id>      Skip model selection; validate against provider's live list.
  --help            Show this help and exit.

Examples:
  alix init
  alix init --provider openai
  alix init --provider openai --model gpt-5
`);
    return;
  }

  // ── Provider + Model (interactive / flagged / auto via orchestrator). ──
  let resolution: Awaited<ReturnType<typeof resolveInitialProviderAndModel>>;
  try {
    resolution = await resolveInitialProviderAndModel(parsedArgs);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const selectedProvider = resolution.providerId;
  let resolvedModel = resolution.modelId;
  // Defensive: if orchestrator returns empty model, fall back to provider's default.
  if (resolvedModel === "") {
    resolvedModel = getDefaultModel(selectedProvider) ?? "";
  }
  if (resolvedModel) {
    console.log(`Using: ${selectedProvider} / ${resolvedModel}`);
  }

  // Step 3: Feature toggles (all enabled by default)
  const enableUi = true;
  const enableMcp = true;
  const enableSkills = true;
  const enableSubagents = true;

  // Build config
  const hasModel = resolvedModel != null && resolvedModel !== "";
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    model: hasModel
      ? { provider: selectedProvider, name: resolvedModel }
      : { ...DEFAULT_CONFIG.model },
    ui: {
      ...DEFAULT_CONFIG.ui,
      enabled: enableUi,
    },
    mcpServers: enableMcp ? [{ type: "stdio" as const, name: "fetch", command: "uvx", args: ["mcp-server-fetch"] }] : [],
    skills: {
      ...DEFAULT_CONFIG.skills,
      factory: { ...DEFAULT_CONFIG.skills!.factory, enabled: false },
    },
    subagents: {
      ...DEFAULT_CONFIG.subagents,
      enabled: enableSubagents,
    },
  };

  // Write .alix/config.json
  await mkdir(alixDir, { recursive: true });
  await writeFile(projectConfigPath, JSON.stringify(config, null, 2) + "\n");

  // Create AGENTS.md
  const agentsContent = `# Project

> Powered by ALiX. See \`.alix/\` for configuration.

## Stack

Define your tech stack here:
- Language:
- Framework:
- Database:

## Rules

- Prefer explicit over implicit
- Add tests for new functionality
- Run lint before commit

## Commands

| Command | Description |
|---------|-------------|
| \`alix run "<task>"\` | Run a task with the agent |

## Build & Test

\`\`\`bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test
\`\`\`
`;
  await writeFile(agentsPath, agentsContent);

  console.log(`\n✓ ALiX initialized in ${workDir}`);
  if (hasModel) {
    console.log(`\nNext steps:`);
    console.log(`  alix run "your first task"`);
    console.log(`  alix serve    # start UI inspector`);
  }
}