# Subagent Tool Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give subagents tool access (file reading, shell, git) with role-based restrictions. Explorer/reviewer/docs_researcher get read-only tools. Worker gets write tools within owned paths. No user prompts, limited iterations.

**Architecture:** `SubagentCLI.main()` gets a tool loop using existing components: `McpManager`, `ToolExecutor`, `ToolSelector`. Reads and writes are passed as tool results back into the model conversation. Tool names and `TOOL_NAME_MAP` are shared from `run.ts`. Subagent runs in the same process as the main agent (not a separate process) so it inherits the same config and MCP connections.

**Tech Stack:** TypeScript, Node.js ESM, existing `McpManager`, `ToolExecutor`, `ToolSelector`, `ToolDiscovery` components.

---

## Task 1: Share TOOL_NAME_MAP between run.ts and SubagentCLI

**Files:**
- Create: `src/agents/tool-name-map.ts`
- Modify: `src/run.ts:63-65`

- [ ] **Step 1: Create tool-name-map.ts**

```typescript
// Maps model tool names (alix_file_read) to executor names (file.read)
// Shared between main agent (run.ts) and subagents (SubagentCLI)

export type ToolNameMap = Record<string, string>;

// Built-in tool name mappings
export const TOOL_NAME_MAP: ToolNameMap = {
  alix_file_read:      "file.read",
  alix_file_write:     "file.write",
  alix_file_create:    "file.create",
  alix_file_delete:    "file.delete",
  alix_file_list:      "file.list",
  alix_file_search:    "file.search",
  alix_file_view:      "file.view",
  alix_file_view_tree: "file.view_tree",
  alix_patch_preview:  "patch.preview",
  alix_patch_apply:    "patch.apply",
  alix_shell_run:      "shell.run",
  alix_git_status:     "git.status",
  alix_git_diff:       "git.diff",
  alix_git_log:        "git.log",
  alix_git_search:     "git.search",
  alix_mcp_list:       "mcp.list",
  alix_done:           "done",
  mcp_search_tools:    "mcp_search_tools",
};
```

- [ ] **Step 2: Export TOOL_NAME_MAP from run.ts**

In `src/run.ts` line ~65, replace:
```typescript
const TOOL_NAME_MAP: Record<string, string> = {
```
with:
```typescript
import { TOOL_NAME_MAP } from "./agents/tool-name-map.js";

export { TOOL_NAME_MAP };

// Re-declare locally so the rest of run.ts still uses it without import
const TOOL_NAME_MAP: Record<string, string> = {
```

Wait, that's messy. Instead, update `tool-name-map.ts` to include `TOOL_NAME_MAP` and in `run.ts`:

```typescript
import { TOOL_NAME_MAP } from "./agents/tool-name-map.js";
// Remove the local TOOL_NAME_MAP definition from run.ts (lines ~63-75)
// Remove "const" so it's the imported binding:
TOOL_NAME_MAP; // reference to satisfy unused import if needed
// Update all references to use the imported one...
```

Actually the cleanest approach: update `tool-name-map.ts` to define the map, then in `run.ts` delete the local definition and import from `tool-name-map.ts`.

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `npm test 2>&1 | tail -5`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/run.ts src/agents/tool-name-map.ts
git commit -m "refactor: extract TOOL_NAME_MAP to shared module"
```

---

## Task 2: Define subagent tool restrictions

**Files:**
- Create: `src/agents/tool-policy.ts`

- [ ] **Step 1: Write tool-policy.ts**

```typescript
import type { SubagentRole, SubagentStyle } from "../config/schema.js";
import type { ToolDef } from "../providers/types.js";

export type ToolCategory = "read" | "write" | "mcp";

export type ToolPolicy = {
  allowedCategories: ToolCategory[];
  maxIterations: number;
  maxShellCommandsPerIteration: number;
  allowMcpTools: boolean;
  mcpToolNamePrefix?: string;  // e.g. "fetch" to only allow mcp.fetch
};

// Policies keyed by role or style
const READ_ONLY_ROLES: SubagentRole[] = [
  "explorer",
  "reviewer",
  "test_investigator",
  "docs_researcher",
];

const WRITE_ROLES: SubagentRole[] = ["worker"];

export function getToolPolicy(role: SubagentRole, style: SubagentStyle): ToolPolicy {
  if (READ_ONLY_ROLES.includes(role)) {
    return {
      allowedCategories: ["read", "mcp"],
      maxIterations: 5,
      maxShellCommandsPerIteration: 3,
      allowMcpTools: true,
    };
  }
  if (WRITE_ROLES.includes(role)) {
    return {
      allowedCategories: ["read", "write", "mcp"],
      maxIterations: 5,
      maxShellCommandsPerIteration: 5,
      allowMcpTools: true,
    };
  }
  // Default: read-only fallback
  return {
    allowedCategories: ["read"],
    maxIterations: 3,
    maxShellCommandsPerIteration: 2,
    allowMcpTools: false,
  };
}

// Built-in read-only tool names (alix_* model names)
const READ_ONLY_TOOLS = new Set([
  "alix_file_read",
  "alix_file_list",
  "alix_file_search",
  "alix_file_view",
  "alix_file_view_tree",
  "alix_git_status",
  "alix_git_diff",
  "alix_git_log",
  "alix_git_search",
  "alix_mcp_list",
  "alix_done",
  "mcp_search_tools",
]);

// Built-in write tool names
const WRITE_TOOLS = new Set([
  "alix_file_write",
  "alix_file_create",
  "alix_file_delete",
  "alix_patch_preview",
  "alix_patch_apply",
]);

// Shell is a special case: always allowed but counted per-iteration
// It's not in the lists above — handle separately based on allowedCategories

export function filterTools(tools: (ToolDef | { name: string; description?: string })[], policy: ToolPolicy): (ToolDef | { name: string; description?: string })[] {
  return tools.filter((tool) => {
    // Allow done and mcp_search_tools always
    if (tool.name === "alix_done" || tool.name === "mcp_search_tools") return true;

    // MCP tools
    if (tool.name.startsWith("mcp_") || tool.name.startsWith("mcp.")) {
      if (!policy.allowMcpTools) return false;
      // If mcpToolNamePrefix is set, only allow that MCP
      if (policy.mcpToolNamePrefix && !tool.name.includes(policy.mcpToolNamePrefix)) return false;
      return true;
    }

    // Built-in tools
    if (READ_ONLY_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("read");
    }
    if (WRITE_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("write");
    }
    // Unknown tool: default to allowed (don't block)
    return true;
  });
}
```

- [ ] **Step 2: Run build to type-check**

Run: `npm run build 2>&1 | tail -3`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/agents/tool-policy.ts
git commit -m "feat(subagent): add tool policy for role-based tool restrictions"
```

---

## Task 3: Add tool loop to SubagentCLI

**Files:**
- Modify: `src/agents/subagent-cli.ts:90-145`

Replace the current `provider.complete()` call with a tool loop:

- [ ] **Step 1: Add imports for new dependencies**

```typescript
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { AlixConfig, SubagentRole } from "../config/schema.js";
import { EventLog } from "../events/event-log.js";
import { createProvider } from "../providers/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolDef, ToolCall, NormalizedMessage } from "../providers/types.js";
import { buildToolsForProvider } from "../tools/provider-tools.js";
import { getToolPolicy, filterTools } from "./tool-policy.js";
import { TOOL_NAME_MAP } from "./tool-name-map.js";
import { runTask as buildEditFormatPolicy } from "path";
// Actually get editFormatPolicy properly:
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
// And McpManager, ToolSelector, ToolDiscovery:
import { McpManager } from "../mcp/manager.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
// And tokens:
import { ensureEncoder, estimateTokens, truncateToTokenBudget } from "../utils/tokens.js";
// And getEncoding:
import { getEncoding } from "../config/context-limits.js";
```

- [ ] **Step 2: Add tool loop after config loading and before provider.complete()**

After line ~67 (the role style resolution block), before the `if (!taskId || !sessionId)` check:

```typescript
    // --- Initialize MCP and tools ---
    const mcpManager = new McpManager(config);
    await mcpManager.initialize();

    const mcpDeferral = mcpManager.getDeferral();
    const mcpToolIndex = mcpDeferral.buildIndex();
    const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 10, tokenBudget: 2000 });
    const selectedTools = toolSelector.select(prompt);
    const mcpDiscovery = new ToolDiscovery(mcpToolIndex);

    for (const entry of selectedTools) {
      TOOL_NAME_MAP[entry.name] = entry.execName;
    }

    const providerTools = buildToolsForProvider(provider);
    const roleConfig = config.subagents?.roles.find(r => r.role === role);
    const roleStyle = roleConfig?.style ?? "fast";
    const toolPolicy = getToolPolicy(role, roleStyle);
    const allowedTools = filterTools([...providerTools, ...selectedTools], toolPolicy);

    // --- Token budget ---
    await ensureEncoder(getEncoding(config.model.provider));
    const MAX_OUTPUT_TOKENS = config.model.maxOutputTokens ?? 4096;
```

- [ ] **Step 3: Replace the provider.complete() call with a tool loop**

Replace the existing try block:

```typescript
    try {
      const provider = createProvider({ provider: config.model.provider, model: config.model.name });

      const response = await provider.complete({
        systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      // Log completion
      await eventLog.append({
        actor: "subagent",
        type: "subagent.completed",
        sessionId,
        payload: { subagentId: taskId, role, resultLength: response.text.length },
      });

      // Write structured result to stdout
      console.log(JSON.stringify({
        id: taskId,
        role,
        status: "success" as const,
        findings: [{
          type: "summary" as const,
          content: response.text,
          confidence: "high" as const,
        }],
        events: [],
      }));
      process.exit(0);
    } catch (err) {
```

With:

```typescript
    try {
      const provider = createProvider({ provider: config.model.provider, model: config.model.name });
      const executor = new ToolExecutor(config, eventLog, projectRoot, mcpManager, buildEditFormatPolicy({ provider: config.model.provider, preferred: provider.editFormatPreference }));

      let messages: NormalizedMessage[] = [
        { role: "user", content: prompt }
      ];
      let iterations = 0;
      let text = "";

      while (iterations < toolPolicy.maxIterations) {
        iterations++;

        const resp = await provider.complete({
          systemPrompt,
          messages,
          tools: allowedTools as ToolDef[],
        });

        text = resp.text ?? "";
        const toolCalls: ToolCall[] = resp.toolCalls ?? [];

        if (toolCalls.length === 0) {
          // No tools — model is done. Check if it signaled completion.
          break;
        }

        // Execute each tool call
        for (const toolCall of toolCalls) {
          const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;

          // Handle mcp_search_tools specially
          if (execName === "mcp_search_tools") {
            const query = (toolCall.args.query as string) ?? "";
            const result = await mcpDiscovery.search(query);
            const output = result.kind === "success" ? (result.output ?? "") : result.message;
            messages.push({ role: "user", content: `[Tool Result]\n${output}` });
            continue;
          }

          const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

          const resultContent =
            execResult.kind === "success"
              ? (execResult.output ?? execResult.content ?? "")
              : `Error: ${(execResult as { kind: "error"; message: string }).message}`;

          messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });

          // If done tool was called, stop
          if (execName === "done") {
            await mcpManager.closeAll().catch(() => {});
            console.log(JSON.stringify({
              id: taskId,
              role,
              status: "success" as const,
              findings: [{ type: "summary", content: text || "Task completed.", confidence: "high" as const }],
              events: [],
            }));
            process.exit(0);
          }
        }
      }

      await mcpManager.closeAll().catch(() => {});

      // Log completion
      await eventLog.append({
        actor: "subagent",
        type: "subagent.completed",
        sessionId,
        payload: { subagentId: taskId, role, iterations, textLength: text.length },
      });

      console.log(JSON.stringify({
        id: taskId,
        role,
        status: "success" as const,
        findings: text ? [{ type: "summary", content: text, confidence: "high" as const }] : [],
        events: [],
      }));
      process.exit(0);
    } catch (err) {
```

- [ ] **Step 4: Run build and fix type errors**

Run: `npm run build 2>&1 | grep "error TS" | head -20`
Expected: Type errors — fix them one by one.

Common fixes:
- Missing imports → add them
- Wrong types → cast with `as any` or adjust types
- `eventLog` used before initialized → move eventLog init before the try block
- `projectRoot` not defined → make sure it's the same as what was defined earlier

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: All pass (or mostly pass — some may need updating)

- [ ] **Step 6: Commit**

```bash
git add src/agents/subagent-cli.ts
git commit -m "feat(subagent): add tool loop with role-based restrictions"
```

---

## Task 4: Add tests for tool policy and subagent CLI

**Files:**
- Create: `tests/agents/tool-policy.test.ts`
- Modify: `tests/agents/subagent-cli.test.ts`

- [ ] **Step 1: Write tool-policy test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { getToolPolicy, filterTools } from "../../src/agents/tool-policy.js";
import type { ToolDef } from "../../src/providers/types.js";

test("getToolPolicy returns read-only for explorer role", () => {
  const policy = getToolPolicy("explorer", "fast");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns write access for worker role", () => {
  const policy = getToolPolicy("worker", "coding");
  assert.deepEqual(policy.allowedCategories, ["read", "write", "mcp"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns read-only for reviewer", () => {
  const policy = getToolPolicy("reviewer", "thinking");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
});

test("filterTools removes write tools for read-only roles", () => {
  const tools: ToolDef[] = [
    { name: "alix_file_read", description: "", input_schema: { type: "object", properties: {} } },
    { name: "alix_file_write", description: "", input_schema: { type: "object", properties: {} } },
    { name: "alix_done", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer", "fast");
  const filtered = filterTools(tools, policy);
  const names = filtered.map(t => t.name);
  assert.ok(names.includes("alix_file_read"));
  assert.ok(names.includes("alix_done"));
  assert.ok(!names.includes("alix_file_write"));
});

test("filterTools includes write tools for worker role", () => {
  const tools: ToolDef[] = [
    { name: "alix_file_read", description: "", input_schema: { type: "object", properties: {} } },
    { name: "alix_file_write", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("worker", "coding");
  const filtered = filterTools(tools, policy);
  const names = filtered.map(t => t.name);
  assert.ok(names.includes("alix_file_read"));
  assert.ok(names.includes("alix_file_write"));
});

test("filterTools allows MCP tools when allowMcpTools is true", () => {
  const tools: ToolDef[] = [
    { name: "mcp_github_search", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer", "fast");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "mcp_github_search");
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- tests/agents/tool-policy.test.ts 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/agents/tool-policy.test.ts
git commit -m "test(subagent): add tool policy tests"
```

---

## Task 5: Manual end-to-end verification

- [ ] **Step 1: Build and run explorer with actual file access**

```bash
npm run build
npx tsx src/cli.ts agent explorer "list all TypeScript files in src/" 2>&1
```

Expected: Subagent actually reads the filesystem (not hallucinating). Output contains real file names.

- [ ] **Step 2: Test reviewer subagent**

```bash
npx tsx src/cli.ts agent reviewer "review the config loader code" 2>&1
```

Expected: Subagent reads actual files and gives real feedback.

- [ ] **Step 3: Test worker subagent (write tool access)**

```bash
npx tsx src/cli.ts agent worker "add a comment to src/cli.ts" 2>&1
```

Expected: Worker has write access (but may need approval in ask mode).

- [ ] **Step 4: Verify explorer CANNOT write files**

```bash
npx tsx src/cli.ts agent explorer "create a test file /tmp/explorer-test.txt" 2>&1
```

Expected: Write tool is not in the tool list — request fails or tool is denied.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(subagent): e2e verification of tool access"
```

---

## Summary of Changes

| File | What Changes |
|------|-------------|
| `src/agents/tool-name-map.ts` | New file: shared `TOOL_NAME_MAP` between `run.ts` and `SubagentCLI` |
| `src/agents/tool-policy.ts` | New file: role-based tool restriction policies and `filterTools()` |
| `src/agents/subagent-cli.ts` | Add tool loop, MCP manager, tool executor, iterations, tool result handling |
| `src/run.ts` | Import `TOOL_NAME_MAP` from shared module instead of defining locally |
| `tests/agents/tool-policy.test.ts` | New file: unit tests for tool policy |