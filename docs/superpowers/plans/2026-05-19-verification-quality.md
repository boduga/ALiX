# Verification Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement verification quality components for command discovery, execution, and reporting

**Architecture:** CommandDiscovery finds test commands, CommandRunner executes safely, VerificationReporter aggregates results.

**Tech Stack:** TypeScript, process execution, test framework adapters

---

## Verification Quality Components

### Task 1: CommandDiscovery

**Files:**
- Create: `src/verification/command-discovery.ts`
- Create: `tests/verification/command-discovery.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/verification/command-discovery.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandDiscovery } from "../../src/verification/command-discovery.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("CommandDiscovery", () => {
  it("discovers npm test scripts", async () => {
    const dir = await mkdir(join(tmpdir(), "cmd-test"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      scripts: { test: "jest", "test:unit": "jest --testPathPattern=unit" }
    }));
    
    const discovery = new CommandDiscovery(dir);
    const commands = await discovery.findTestCommands();
    
    assert.ok(commands.some(c => c.name === "test" && c.command === "npm test"));
  });

  it("finds make targets for C projects", async () => {
    const dir = await mkdir(join(tmpdir(), "make-test"), { recursive: true });
    await writeFile(join(dir, "Makefile"), "test:\n\tmake unit-test\n\nunit-test:\n\t./run_tests.sh");
    
    const discovery = new CommandDiscovery(dir);
    const commands = await discovery.findTestCommands();
    
    assert.ok(commands.some(c => c.name === "test"));
  });

  it("detects pytest configurations", async () => {
    const dir = await mkdir(join(tmpdir(), "pytest-test"), { recursive: true });
    await writeFile(join(dir, "pytest.ini"), "[pytest]\ntestpaths = tests");
    await writeFile(join(dir, "tests/test_example.py"), "def test_placeholder(): pass");
    
    const discovery = new CommandDiscovery(dir);
    const commands = await discovery.findTestCommands();
    
    assert.ok(commands.length > 0);
  });

  it("returns empty for non-test projects", async () => {
    const discovery = new CommandDiscovery("/tmp");
    const commands = await discovery.findTestCommands();
    assert.equal(commands.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verification/command-discovery.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CommandDiscovery**

```typescript
// src/verification/command-discovery.ts
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verification/command-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/command-discovery.ts tests/verification/command-discovery.test.ts
git commit -m "feat(verification): add CommandDiscovery for test framework detection"
```

---

### Task 2: CommandRunner

**Files:**
- Create: `src/verification/command-runner.ts`
- Create: `tests/verification/command-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/verification/command-runner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandRunner } from "../../src/verification/command-runner.js";

describe("CommandRunner", () => {
  it("executes command and captures output", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo 'hello world'", { timeout: 5000 });
    
    assert.ok(result.success);
    assert.ok(result.stdout.includes("hello world"));
    assert.equal(result.exitCode, 0);
  });

  it("respects timeout", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("sleep 10", { timeout: 100 });
    
    assert.ok(!result.success);
    assert.equal(result.error, "timeout");
  });

  it("captures stderr separately", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo error >&2", { timeout: 5000 });
    
    assert.ok(result.stderr.includes("error"));
  });

  it("tracks duration", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo test", { timeout: 5000 });
    
    assert.ok(result.durationMs >= 0);
    assert.ok(result.durationMs < 5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verification/command-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CommandRunner**

```typescript
// src/verification/command-runner.ts
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";

const execAsync = promisify(execCallback);

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: "timeout" | "killed" | "spawn_error" | string;
  signal?: string;
}

export interface RunOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
}

export class CommandRunner {
  private defaultTimeout: number;

  constructor(defaultTimeout = 30000) {
    this.defaultTimeout = defaultTimeout;
  }

  async run(command: string, options: RunOptions = {}): Promise<RunResult> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        timeout,
        shell: options.shell ?? true,
      });
      
      const durationMs = Date.now() - startTime;
      
      return {
        success: true,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      if (error.killed) {
        return {
          success: false,
          stdout: "",
          stderr: "",
          exitCode: -1,
          durationMs,
          error: "timeout",
          signal: error.signal,
        };
      }
      
      return {
        success: false,
        stdout: error.stdout?.toString() ?? "",
        stderr: error.stderr?.toString() ?? "",
        exitCode: error.code ?? -1,
        durationMs,
        error: error.message,
      };
    }
  }

  async runWithStreaming(
    command: string,
    options: RunOptions = {},
    onOutput: (data: string, isStderr: boolean) => void
  ): Promise<RunResult> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      
      const child = spawn(command, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        shell: options.shell ?? true,
      });
      
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);
      
      child.stdout.on("data", (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        onOutput(str, false);
      });
      
      child.stderr.on("data", (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        onOutput(str, true);
      });
      
      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? -1,
          durationMs,
        });
      });
      
      child.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        
        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: -1,
          durationMs,
          error: err.message,
        });
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verification/command-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/command-runner.ts tests/verification/command-runner.test.ts
git commit -m "feat(verification): add CommandRunner for safe command execution"
```

---

### Task 3: VerificationReporter

**Files:**
- Create: `src/verification/verification-reporter.ts`
- Create: `tests/verification/verification-reporter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/verification/verification-reporter.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { VerificationReporter } from "../../src/verification/verification-reporter.js";
import type { RunResult } from "../../src/verification/command-runner.js";

describe("VerificationReporter", () => {
  it("aggregates multiple test results", () => {
    const reporter = new VerificationReporter();
    
    reporter.addResult({ name: "test-1", result: { success: true, exitCode: 0, durationMs: 100, stdout: "", stderr: "" } });
    reporter.addResult({ name: "test-2", result: { success: true, exitCode: 0, durationMs: 200, stdout: "", stderr: "" } });
    
    const summary = reporter.getSummary();
    assert.equal(summary.total, 2);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 0);
  });

  it("detects failures from exit code", () => {
    const reporter = new VerificationReporter();
    
    reporter.addResult({
      name: "failing-test",
      result: { success: false, exitCode: 1, durationMs: 50, stdout: "", stderr: "Assertion failed" }
    });
    
    const summary = reporter.getSummary();
    assert.equal(summary.failed, 1);
  });

  it("extracts test count from output", () => {
    const reporter = new VerificationReporter();
    
    reporter.addResult({
      name: "jest-output",
      result: { success: true, exitCode: 0, durationMs: 1000, stdout: "Tests: 5 passed, 1 failed", stderr: "" }
    });
    
    const analysis = reporter.analyzeOutput("jest-output");
    assert.ok(analysis.testCount);
  });

  it("generates markdown report", () => {
    const reporter = new VerificationReporter();
    reporter.addResult({ name: "test", result: { success: true, exitCode: 0, durationMs: 50, stdout: "", stderr: "" } });
    
    const report = reporter.generateMarkdownReport();
    assert.ok(report.includes("## Verification Results"));
    assert.ok(report.includes("test"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verification/verification-reporter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement VerificationReporter**

```typescript
// src/verification/verification-reporter.ts
import type { RunResult } from "./command-runner.js";

export interface VerificationResult {
  name: string;
  result: RunResult;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface VerificationSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  passRate: number;
}

export interface TestAnalysis {
  testCount?: number;
  passed?: number;
  failed?: number;
  duration?: string;
  framework?: string;
}

export class VerificationReporter {
  private results: VerificationResult[] = [];

  addResult(result: VerificationResult): void {
    this.results.push({
      ...result,
      timestamp: result.timestamp ?? Date.now(),
    });
  }

  getResults(): VerificationResult[] {
    return [...this.results];
  }

  getSummary(): VerificationSummary {
    const passed = this.results.filter(r => r.result.success).length;
    const failed = this.results.filter(r => !r.result.success).length;
    const skipped = this.results.filter(r => r.result.error === "skipped").length;
    const totalDurationMs = this.results.reduce((sum, r) => sum + r.result.durationMs, 0);
    
    return {
      total: this.results.length,
      passed,
      failed,
      skipped,
      totalDurationMs,
      passRate: this.results.length > 0 ? passed / this.results.length : 0,
    };
  }

  analyzeOutput(testName: string): TestAnalysis {
    const result = this.results.find(r => r.name === testName);
    if (!result) return {};
    
    const analysis: TestAnalysis = {};
    const stdout = result.result.stdout;
    
    const jestMatch = stdout.match(/Tests:?\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (jestMatch) {
      analysis.testCount = parseInt(jestMatch[1]) + parseInt(jestMatch[2]);
      analysis.passed = parseInt(jestMatch[1]);
      analysis.failed = parseInt(jestMatch[2]);
      analysis.framework = "jest";
    }
    
    const pytestMatch = stdout.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (pytestMatch && !analysis.testCount) {
      analysis.testCount = parseInt(pytestMatch[1]) + parseInt(pytestMatch[2]);
      analysis.passed = parseInt(pytestMatch[1]);
      analysis.failed = parseInt(pytestMatch[2]);
      analysis.framework = "pytest";
    }
    
    const mochaMatch = stdout.match(/(\d+)\s+passing/i);
    if (mochaMatch) {
      analysis.testCount = parseInt(mochaMatch[1]);
      analysis.passed = parseInt(mochaMatch[1]);
      analysis.framework = "mocha";
    }
    
    const durationMatch = stdout.match(/(\d+)m\s+(\d+)s/);
    if (durationMatch) {
      analysis.duration = `${durationMatch[1]}m ${durationMatch[2]}s`;
    }
    
    return analysis;
  }

  generateMarkdownReport(options: { verbose?: boolean; includeOutput?: boolean } = {}): string {
    const summary = this.getSummary();
    const lines: string[] = [];
    
    lines.push("## Verification Results\n");
    lines.push(`**Total:** ${summary.total} | **Passed:** ${summary.passed} | **Failed:** ${summary.failed} | **Pass Rate:** ${(summary.passRate * 100).toFixed(1)}%\n`);
    lines.push(`**Duration:** ${(summary.totalDurationMs / 1000).toFixed(2)}s\n`);
    
    if (summary.failed > 0) {
      lines.push("\n### Failed Tests\n");
      
      for (const result of this.results.filter(r => !r.result.success)) {
        lines.push(`- ❌ **${result.name}**`);
        if (result.result.stderr) {
          lines.push(`  \`\`\`\n${result.result.stderr.slice(0, 500)}\n  \`\`\``);
        }
      }
    }
    
    if (options.verbose) {
      lines.push("\n### All Tests\n");
      
      for (const result of this.results) {
        const status = result.result.success ? "✅" : "❌";
        lines.push(`- ${status} **${result.name}** (${result.result.durationMs}ms)`);
        
        if (options.includeOutput && result.result.stderr) {
          lines.push(`  \`\`\`\n${result.result.stderr.slice(0, 200)}...\n  \`\`\``);
        }
      }
    }
    
    return lines.join("\n");
  }

  generateJsonReport(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      results: this.results,
      generatedAt: new Date().toISOString(),
    }, null, 2);
  }

  clear(): void {
    this.results = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verification/verification-reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/verification-reporter.ts tests/verification/verification-reporter.test.ts
git commit -m "feat(verification): add VerificationReporter for test result aggregation"
```

---

### Task 4: VerificationPipeline Integration

**Files:**
- Create: `src/verification/verification-pipeline.ts`
- Create: `tests/verification/verification-pipeline.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/verification/verification-pipeline.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { VerificationPipeline } from "../../src/verification/verification-pipeline.js";

describe("VerificationPipeline", () => {
  it("runs discovery and execution in sequence", async () => {
    const pipeline = new VerificationPipeline({ cwd: process.cwd() });
    const result = await pipeline.run();
    
    assert.ok(result.discovered.length >= 0);
    assert.ok(result.executed.length >= 0);
  });

  it("stops on first failure when configured", async () => {
    const pipeline = new VerificationPipeline({
      cwd: process.cwd(),
      stopOnFailure: true,
    });
    
    const result = await pipeline.run();
    assert.ok(result.success || result.partial);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verification/verification-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement VerificationPipeline**

```typescript
// src/verification/verification-pipeline.ts
import { CommandDiscovery } from "./command-discovery.js";
import { CommandRunner } from "./command-runner.js";
import { VerificationReporter } from "./verification-reporter.js";

export interface PipelineResult {
  success: boolean;
  partial: boolean;
  discovered: string[];
  executed: { name: string; success: boolean }[];
  reporter: VerificationReporter;
  error?: string;
}

export interface VerificationPipelineOptions {
  cwd?: string;
  stopOnFailure?: boolean;
  timeout?: number;
  verbose?: boolean;
}

export class VerificationPipeline {
  private discovery: CommandDiscovery;
  private runner: CommandRunner;
  private options: Required<VerificationPipelineOptions>;

  constructor(options: VerificationPipelineOptions = {}) {
    this.options = {
      cwd: options.cwd ?? process.cwd(),
      stopOnFailure: options.stopOnFailure ?? false,
      timeout: options.timeout ?? 60000,
      verbose: options.verbose ?? false,
    };
    
    this.discovery = new CommandDiscovery(this.options.cwd);
    this.runner = new CommandRunner(this.options.timeout);
  }

  async run(): Promise<PipelineResult> {
    const reporter = new VerificationReporter();
    
    try {
      const commands = await this.discovery.findTestCommands();
      const discovered = commands.map(c => c.name);
      
      let stopOnFailure = false;
      const executed: { name: string; success: boolean }[] = [];
      
      for (const cmd of commands) {
        if (stopOnFailure) {
          reporter.addResult({
            name: cmd.name,
            result: { success: false, stdout: "", stderr: "", exitCode: -1, durationMs: 0, error: "skipped" },
          });
          executed.push({ name: cmd.name, success: false });
          continue;
        }
        
        if (this.options.verbose) {
          console.log(`Running: ${cmd.command}`);
        }
        
        const result = await this.runner.run(cmd.command, { timeout: this.options.timeout });
        
        reporter.addResult({
          name: cmd.name,
          result,
        });
        
        executed.push({ name: cmd.name, success: result.success });
        
        if (!result.success && this.options.stopOnFailure) {
          stopOnFailure = true;
        }
      }
      
      const summary = reporter.getSummary();
      
      return {
        success: summary.failed === 0,
        partial: summary.failed > 0 && summary.passed > 0,
        discovered,
        executed,
        reporter,
      };
    } catch (error: any) {
      return {
        success: false,
        partial: false,
        discovered: [],
        executed: [],
        reporter,
        error: error.message,
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verification/verification-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/verification-pipeline.ts tests/verification/verification-pipeline.test.ts
git commit -m "feat(verification): add VerificationPipeline for end-to-end test execution"
```

---

## Execution Options

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**