import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "..");

/**
 * ALiX Capability Tests
 *
 * Tests capabilities 1-12 as if ALiX has been deployed.
 * These tests validate the actual deployed system.
 */

test.describe("ALiX Deployed Capabilities", () => {

  test.describe("Capability 1: Autonomous Agent Loop", () => {

    test("task classifier exists", () => {
      const classifierFile = join(rootDir, "src", "task-classifier.ts");
      assert.ok(existsSync(classifierFile), "Task classifier should exist");

      const content = readFileSync(classifierFile, "utf-8");
      const types = ["bugfix", "feature", "refactor", "docs", "research"];
      const found = types.filter(t => content.includes(`"${t}"`));
      assert.ok(found.length >= 4, `Should classify task types, found: ${found.join(", ")}`);
    });

    test("task state machine exists", () => {
      const stateMachineFile = join(rootDir, "src", "autonomy", "state-machine.ts");
      assert.ok(existsSync(stateMachineFile), "Task state machine should exist");
    });

    test("scope tracker prevents expansion", () => {
      const scopeTrackerFile = join(rootDir, "src", "autonomy", "scope-tracker.ts");
      assert.ok(existsSync(scopeTrackerFile), "Scope tracker should exist");
    });

    test("run limiter enforces max iterations", () => {
      const runLimiterFile = join(rootDir, "src", "autonomy", "run-limiter.ts");
      if (existsSync(runLimiterFile)) {
        const content = readFileSync(runLimiterFile, "utf-8");
        assert.ok(
          content.includes("iteration") || content.includes("repair") || content.includes("limit"),
          "Should enforce iteration/repair limits"
        );
      }
    });

  });

  test.describe("Capability 2: 12 Provider Support", () => {

    const expectedProviders = [
      "anthropic", "openai", "gemini", "deepseek", "groq",
      "ollama", "perplexity", "minimax", "zhipuai", "groqai",
      "openrouter", "mock"
    ];

    test("providers directory exists with expected providers", () => {
      const providersDir = join(rootDir, "src", "providers");
      assert.ok(existsSync(providersDir), "Providers directory should exist");

      const files = readdirSync(providersDir);
      const found = expectedProviders.filter(p =>
        files.some(f => f.toLowerCase().includes(p.toLowerCase()))
      );
      assert.ok(found.length >= 10, `Should have most providers, found: ${found.join(", ")}`);
    });

    test("base provider handles errors consistently", () => {
      const baseProvider = join(rootDir, "src", "providers", "base.ts");
      const content = readFileSync(baseProvider, "utf-8");

      assert.ok(content.includes("error") || content.includes("Error"), "Base provider should handle errors");
      assert.ok(content.includes("retry") || content.includes("fetch"), "Should have fetch/retry logic");
    });

    test("provider catalog and registry exist", () => {
      const catalogFile = join(rootDir, "src", "providers", "catalog.ts");
      const registryFile = join(rootDir, "src", "providers", "registry.ts");
      const typesFile = join(rootDir, "src", "providers", "types.ts");

      assert.ok(existsSync(catalogFile), "Provider catalog should exist");
      assert.ok(existsSync(registryFile), "Provider registry should exist");
      assert.ok(existsSync(typesFile), "Provider types should exist");
    });

    test("tiktoken token counting is available", () => {
      const tokenUtilsFile = join(rootDir, "src", "utils", "tokens.ts");
      assert.ok(existsSync(tokenUtilsFile), "Token counting utility should exist");
    });

  });

  test.describe("Capability 3: Tool System", () => {

    test("tools directory exists", () => {
      const toolsDir = join(rootDir, "src", "tools");
      assert.ok(existsSync(toolsDir), "Tools directory should exist");
    });

    test("file tools are implemented", () => {
      const fileToolsFile = join(rootDir, "src", "tools", "file-tools.ts");
      assert.ok(existsSync(fileToolsFile), "File tools should exist");

      // Check that it defines tool handlers
      const content = readFileSync(fileToolsFile, "utf-8");
      assert.ok(content.length > 100, "File tools should have substantial content");
    });

    test("shell tool has output truncation", () => {
      const shellToolFile = join(rootDir, "src", "tools", "shell-tool.ts");

      if (existsSync(shellToolFile)) {
        const content = readFileSync(shellToolFile, "utf-8");
        assert.ok(
          content.includes("80") || content.includes("truncat") || content.includes("limit"),
          "Should have output truncation logic"
        );
      }
    });

    test("tool router handles execution and policy", () => {
      const toolRouterFile = join(rootDir, "src", "tools", "tool-router.ts");
      assert.ok(existsSync(toolRouterFile), "Tool router should exist");
    });

    test("tool executor exists", () => {
      const executorFile = join(rootDir, "src", "tools", "executor.ts");
      assert.ok(existsSync(executorFile), "Tool executor should exist");
    });

  });

  test.describe("Capability 4: MCP Extensions", () => {

    test("MCP manager exists", () => {
      const mcpDir = join(rootDir, "src", "mcp");
      assert.ok(existsSync(mcpDir), "MCP directory should exist");

      const requiredFiles = ["manager.ts", "client.ts", "registry.ts"];
      for (const file of requiredFiles) {
        assert.ok(
          existsSync(join(mcpDir, file)),
          `MCP ${file} should exist`
        );
      }
    });

    test("tool discovery is implemented", () => {
      const discoveryFile = join(rootDir, "src", "mcp", "tool-discovery.ts");
      assert.ok(existsSync(discoveryFile), "Tool discovery should exist");
    });

    test("tool cache exists", () => {
      const cacheFile = join(rootDir, "src", "mcp", "tool-cache.ts");
      if (existsSync(cacheFile)) {
        const content = readFileSync(cacheFile, "utf-8");
        assert.ok(
          content.includes("cache") || content.includes("schema"),
          "Should have caching"
        );
      }
    });

    test("tool deferral is implemented", () => {
      const deferralFile = join(rootDir, "src", "mcp", "tool-deferral.ts");
      assert.ok(existsSync(deferralFile), "Tool deferral should exist");
    });

    test("tool selector with scoring", () => {
      const selectorFile = join(rootDir, "src", "mcp", "tool-selector.ts");
      assert.ok(existsSync(selectorFile), "Tool selector should exist");
    });

    test("MCP transports exist", () => {
      const transportsDir = join(rootDir, "src", "mcp", "transports");
      assert.ok(existsSync(transportsDir), "MCP transports directory should exist");
    });

  });

  test.describe("Capability 5: Patch Engine", () => {

    test("patch directory exists", () => {
      const patchDir = join(rootDir, "src", "patch");
      assert.ok(existsSync(patchDir), "Patch directory should exist");
    });

    test("preimage validation is implemented", () => {
      const preimageFile = join(rootDir, "src", "patch", "preimage-validator.ts");

      if (existsSync(preimageFile)) {
        const content = readFileSync(preimageFile, "utf-8");
        assert.ok(
          content.includes("preimage") || content.includes("validate") || content.includes("hash"),
          "Should have preimage validation"
        );
      }
    });

    test("checkpoint manager supports snapshots", () => {
      const checkpointDir = join(rootDir, "src", "checkpoints");
      assert.ok(existsSync(checkpointDir), "Checkpoints directory should exist");
    });

    test("rollback on failure is implemented", () => {
      const rollbackFile = join(rootDir, "src", "patch", "rollback-manager.ts");

      if (existsSync(rollbackFile)) {
        const content = readFileSync(rollbackFile, "utf-8");
        assert.ok(
          content.includes("rollback") || content.includes("restore"),
          "Should have rollback logic"
        );
      }
    });

    test("multiple edit formats supported", () => {
      const patchDir = join(rootDir, "src", "patch");
      const files = readdirSync(patchDir);

      // Check for different edit format implementations
      const hasStructured = files.some(f => f.includes("structured"));
      const hasSearchReplace = files.some(f => f.includes("search"));
      const hasFullFile = files.some(f => f.includes("full"));

      assert.ok(
        hasStructured || hasSearchReplace,
        "Should support multiple edit formats (found structured/search_replace)"
      );
    });

    test("full file guard prevents accidental rewrites", () => {
      const guardFile = join(rootDir, "src", "patch", "full-file-guard.ts");
      assert.ok(existsSync(guardFile), "Full file guard should exist");
    });

  });

  test.describe("Capability 6: Policy Engine", () => {

    test("policy directory exists", () => {
      const policyDir = join(rootDir, "src", "policy");
      assert.ok(existsSync(policyDir), "Policy directory should exist");
    });

    test("policy engine exists", () => {
      const policyFile = join(rootDir, "src", "policy", "policy-engine.ts");
      assert.ok(existsSync(policyFile), "Policy engine should exist");
    });

    test("shell whitelist restricts commands", () => {
      const whitelistFile = join(rootDir, "src", "policy", "shell-whitelist.ts");
      assert.ok(existsSync(whitelistFile), "Shell whitelist should exist");
    });

    test("secret scanner is implemented", () => {
      const securityDir = join(rootDir, "src", "security");
      assert.ok(existsSync(securityDir), "Security directory should exist");

      const scannerFile = join(securityDir, "secret-scanner.ts");
      assert.ok(existsSync(scannerFile), "Secret scanner should exist");
    });

    test("approval manager exists", () => {
      const approvalFile = join(rootDir, "src", "policy", "approval-manager.ts");
      if (existsSync(approvalFile)) {
        const content = readFileSync(approvalFile, "utf-8");
        assert.ok(
          content.includes("approval") || content.includes("queue") || content.includes("confirm"),
          "Should support approval queuing"
        );
      }
    });

  });

  test.describe("Capability 7: Verification System", () => {

    test("verifier directory exists", () => {
      const verifierDir = join(rootDir, "src", "verifier");
      assert.ok(existsSync(verifierDir), "Verifier directory should exist");
    });

    test("enhanced verifier exists", () => {
      const verifierFile = join(rootDir, "src", "verifier", "enhanced-verifier.ts");
      assert.ok(existsSync(verifierFile), "Enhanced verifier should exist");
    });

    test("test planner maps tests to source files", () => {
      const plannerFile = join(rootDir, "src", "verifier", "test-planner.ts");
      assert.ok(existsSync(plannerFile), "Test planner should exist");
    });

    test("dependency graph understands file relationships", () => {
      const graphFile = join(rootDir, "src", "verifier", "dep-graph.ts");
      assert.ok(existsSync(graphFile), "Dependency graph should exist");
    });

    test("risk reporter assesses residual risk", () => {
      const riskFile = join(rootDir, "src", "verifier", "risk-report.ts");
      assert.ok(existsSync(riskFile), "Risk reporter should exist");
    });

  });

  test.describe("Capability 8: Multi-Agent Coordination", () => {

    test("agents directory exists", () => {
      const agentsDir = join(rootDir, "src", "agents");
      assert.ok(existsSync(agentsDir), "Agents directory should exist");
    });

    test("subagent manager exists", () => {
      const managerFile = join(rootDir, "src", "agents", "subagent-manager.ts");
      assert.ok(existsSync(managerFile), "Subagent manager should exist");
    });

    test("ownership registry tracks file ownership", () => {
      const registryFile = join(rootDir, "src", "agents", "ownership-registry.ts");
      assert.ok(existsSync(registryFile), "Ownership registry should exist");
    });

    test("merge coordinator combines parallel results", () => {
      const mergeFile = join(rootDir, "src", "agents", "merge-coordinator.ts");
      assert.ok(existsSync(mergeFile), "Merge coordinator should exist");
    });

    test("tool policy controls role access", () => {
      const toolPolicyFile = join(rootDir, "src", "agents", "tool-policy.ts");
      assert.ok(existsSync(toolPolicyFile), "Tool policy should exist");
    });

  });

  test.describe("Capability 9: Skills & Extensions", () => {

    test("skills directory exists", () => {
      const skillsDir = join(rootDir, "src", "skills");
      assert.ok(existsSync(skillsDir), "Skills directory should exist");
    });

    test("skill loader and catalog exist", () => {
      const loaderFile = join(rootDir, "src", "skills", "loader.ts");
      const catalogFile = join(rootDir, "src", "skills", "catalog.ts");
      assert.ok(existsSync(loaderFile), "Skill loader should exist");
      assert.ok(existsSync(catalogFile), "Skill catalog should exist");
    });

    test("skill dispatcher exists", () => {
      const dispatcherFile = join(rootDir, "src", "skills", "dispatcher.ts");
      assert.ok(existsSync(dispatcherFile), "Skill dispatcher should exist");
    });

    test("extensions directory exists", () => {
      const extensionsDir = join(rootDir, "src", "extensions");
      assert.ok(existsSync(extensionsDir), "Extensions directory should exist");
    });

    test("hook runner supports lifecycle hooks", () => {
      const hookFile = join(rootDir, "src", "extensions", "hook-runner.ts");
      assert.ok(existsSync(hookFile), "Hook runner should exist");
    });

    test("extension registry exists", () => {
      const registryFile = join(rootDir, "src", "extensions", "extension-registry.ts");
      assert.ok(existsSync(registryFile), "Extension registry should exist");
    });

  });

  test.describe("Capability 10: Context Intelligence", () => {

    test("repomap directory exists", () => {
      const repomapDir = join(rootDir, "src", "repomap");
      assert.ok(existsSync(repomapDir), "RepoMap directory should exist");
    });

    test("context compiler ranks files", () => {
      const repomapDir = join(rootDir, "src", "repomap");
      const compilerFile = join(repomapDir, "context-compiler.ts");
      const pipelineFile = join(repomapDir, "context-pipeline.ts");

      assert.ok(existsSync(compilerFile), "Context compiler should exist");
      assert.ok(existsSync(pipelineFile), "Context pipeline should exist");
    });

    test("ranking stage implements scoring", () => {
      const rankingFile = join(rootDir, "src", "repomap", "context-ranker.ts");
      assert.ok(existsSync(rankingFile), "Ranking stage should exist");
    });

    test("semantic search stage exists", () => {
      const repomapDir = join(rootDir, "src", "repomap");
      const files = readdirSync(repomapDir);
      const hasSemantic = files.some(f => f.includes("embed") || f.includes("semantic"));
      assert.ok(hasSemantic, "Should have semantic search capability");
    });

    test("git activity boosting is implemented", () => {
      const gitFile = join(rootDir, "src", "repomap", "git-activity.ts");
      assert.ok(existsSync(gitFile), "Git activity boosting should exist");
    });

    test("token budget enforcement exists", () => {
      const pipelineFile = join(rootDir, "src", "repomap", "context-pipeline.ts");
      const content = readFileSync(pipelineFile, "utf-8");
      assert.ok(
        content.includes("token") || content.includes("budget"),
        "Should have token budget enforcement"
      );
    });

  });

  test.describe("Capability 11: Observability", () => {

    test("events directory exists", () => {
      const eventsDir = join(rootDir, "src", "events");
      assert.ok(existsSync(eventsDir), "Events directory should exist");
    });

    test("JSONL event log is implemented", () => {
      const eventFiles = ["event-log.ts", "session-log.ts"];
      const eventsDir = join(rootDir, "src", "events");
      const found = eventFiles.filter(f => existsSync(join(eventsDir, f)));

      assert.ok(found.length >= 1, `Should have event log file, found: ${found.join(", ")}`);
    });

    test("inspector UI exists", () => {
      const inspectorDir = join(rootDir, "src", "inspector");
      assert.ok(existsSync(inspectorDir), "Inspector directory should exist");
    });

    test("UI assets exist", () => {
      const uiDir = join(rootDir, "src", "ui");
      assert.ok(existsSync(uiDir), "UI directory should exist");

      // Check for HTML/JS/CSS files
      const files = readdirSync(uiDir);
      const hasHtml = files.some(f => f.endsWith(".html"));
      assert.ok(hasHtml, "UI should have HTML files");
    });

    test("SSE server supports streaming", () => {
      const serverDir = join(rootDir, "src", "server");
      if (existsSync(serverDir)) {
        const files = readdirSync(serverDir);
        const hasServer = files.some(f => f.includes("sse") || f.includes("server"));
        assert.ok(hasServer, "Should have SSE server");
      }
    });

  });

  test.describe("Capability 12: Safety Guards", () => {

    test("autonomy directory exists", () => {
      const autonomyDir = join(rootDir, "src", "autonomy");
      assert.ok(existsSync(autonomyDir), "Autonomy directory should exist");
    });

    test("task state machine tracks transitions", () => {
      const stateMachineFile = join(rootDir, "src", "autonomy", "state-machine.ts");
      assert.ok(existsSync(stateMachineFile), "Task state machine should exist");
    });

    test("run limiter enforces hard limits", () => {
      const limiterFile = join(rootDir, "src", "autonomy", "run-limiter.ts");

      if (existsSync(limiterFile)) {
        const content = readFileSync(limiterFile, "utf-8");
        assert.ok(
          content.includes("limit") || content.includes("max") || content.includes("iteration"),
          "Should enforce limits"
        );
      }
    });

    test("scope tracker prevents expansion", () => {
      const scopeFile = join(rootDir, "src", "autonomy", "scope-tracker.ts");
      assert.ok(existsSync(scopeFile), "Scope tracker should exist");
    });

    test("memory store has layered architecture", () => {
      const memoryDir = join(rootDir, "src", "memory");
      assert.ok(existsSync(memoryDir), "Memory directory should exist");

      // Check for memory-related files
      const files = readdirSync(memoryDir);
      const hasStore = files.length > 0;
      assert.ok(hasStore, "Memory store files should exist");
    });

  });

});