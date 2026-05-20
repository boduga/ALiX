import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DiscoveredCommand {
  name: string;
  command: string;
  framework?: string;
  filePattern?: string;
  priority: number;
}

export interface CommandDiscoveryOptions {
  frameworks?: string[];
  prioritizeFastFirst?: boolean;
}

export class CommandDiscovery {
  private rootDir: string;
  private frameworks: string[];

  constructor(rootDir: string, options: CommandDiscoveryOptions = {}) {
    this.rootDir = rootDir;
    this.frameworks = options.frameworks ?? ["npm", "pytest", "jest", "mocha", "go", "make"];
  }

  async findTestCommands(): Promise<DiscoveredCommand[]> {
    const commands: DiscoveredCommand[] = [];

    const npmCommands = await this.discoverNpmCommands();
    commands.push(...npmCommands);

    const makeCommands = await this.discoverMakeTargets();
    commands.push(...makeCommands);

    const pythonCommands = await this.discoverPythonCommands();
    commands.push(...pythonCommands);

    return commands.sort((a, b) => a.priority - b.priority);
  }

  private async discoverNpmCommands(): Promise<DiscoveredCommand[]> {
    try {
      const packageJsonPath = join(this.rootDir, "package.json");
      const content = await readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      const commands: DiscoveredCommand[] = [];

      if (pkg.scripts?.test) {
        commands.push({
          name: "test",
          command: "npm test",
          framework: "npm",
          priority: 1,
        });
      }

      if (pkg.scripts?.["test:unit"]) {
        commands.push({
          name: "unit",
          command: "npm run test:unit",
          framework: "npm",
          priority: 2,
        });
      }

      if (pkg.scripts?.["test:integration"]) {
        commands.push({
          name: "integration",
          command: "npm run test:integration",
          framework: "npm",
          priority: 3,
        });
      }

      return commands;
    } catch {
      return [];
    }
  }

  private async discoverMakeTargets(): Promise<DiscoveredCommand[]> {
    try {
      const makefilePath = join(this.rootDir, "Makefile");
      const content = await readFile(makefilePath, "utf-8");

      const commands: DiscoveredCommand[] = [];
      const lines = content.split("\n");

      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+):/);
        if (match && match[1] !== ".PHONY") {
          const target = match[1];
          if (target.includes("test") || target === "all") {
            commands.push({
              name: target,
              command: `make ${target}`,
              framework: "make",
              priority: target === "test" ? 1 : 5,
            });
          }
        }
      }

      return commands;
    } catch {
      return [];
    }
  }

  private async discoverPythonCommands(): Promise<DiscoveredCommand[]> {
    try {
      const commands: DiscoveredCommand[] = [];

      const hasPytest = await this.fileExists(join(this.rootDir, "pytest.ini")) ||
                       await this.fileExists(join(this.rootDir, "pyproject.toml")) ||
                       await this.fileExists(join(this.rootDir, "setup.cfg"));

      if (hasPytest) {
        commands.push({
          name: "pytest",
          command: "pytest",
          framework: "pytest",
          priority: 1,
        });

        commands.push({
          name: "pytest-unit",
          command: "pytest tests/unit",
          framework: "pytest",
          priority: 2,
        });
      }

      const hasTox = await this.fileExists(join(this.rootDir, "tox.ini"));
      if (hasTox) {
        commands.push({
          name: "tox",
          command: "tox",
          framework: "tox",
          priority: 4,
        });
      }

      return commands;
    } catch {
      return [];
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  async detectFramework(): Promise<string | null> {
    const commands = await this.findTestCommands();
    if (commands.length === 0) return null;

    const sorted = [...commands].sort((a, b) => a.priority - b.priority);
    return sorted[0].framework ?? null;
  }
}