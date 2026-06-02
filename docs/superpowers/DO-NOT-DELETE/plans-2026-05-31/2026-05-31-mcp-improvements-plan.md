**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# MCP Client Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve ALiX's MCP client: better error messages, retry on transient failures, and a built-in registry of popular MCP servers users can browse.

**Architecture:** Additions to `src/mcp/` for error normalization and a static registry of well-known MCP servers. No breaking changes to the existing API.

**Tech Stack:** TypeScript, `node:test`, existing MCP modules.

---

## File Structure

**New files:**
- `src/mcp/error-format.ts` — Error normalization (~80 lines)
- `src/mcp/server-registry.ts` — Curated list of known MCP servers (~100 lines)
- `src/mcp/retry.ts` — Retry logic for transient failures (~50 lines)
- `tests/mcp/error-format.test.ts` — Error tests
- `tests/mcp/server-registry.test.ts` — Registry tests
- `tests/mcp/retry.test.ts` — Retry tests

**Modified files:**
- `src/mcp/manager.ts` — Use new error format and retry
- `src/mcp/tool-discovery.ts` — Better error messages

---

## Task 1: Create error normalizer (TDD)

**Files:**
- Create: `tests/mcp/error-format.test.ts`
- Create: `src/mcp/error-format.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/mcp/error-format.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMcpError, classifyMcpError, type McpError } from "../../src/mcp/error-format.js";

describe("formatMcpError", () => {
  it("formats connection refused", () => {
    const e: McpError = { kind: "connection", server: "github", cause: "ECONNREFUSED" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("connect") || msg.includes("refused"));
  });

  it("formats timeout", () => {
    const e: McpError = { kind: "timeout", server: "github", timeoutMs: 5000 };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("timeout") || msg.includes("5000"));
  });

  it("formats tool not found", () => {
    const e: McpError = { kind: "tool_not_found", server: "github", tool: "nonexistent" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("nonexistent"));
  });

  it("formats invalid response", () => {
    const e: McpError = { kind: "invalid_response", server: "github", detail: "JSON parse failed" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("JSON parse failed"));
  });
});

describe("classifyMcpError", () => {
  it("classifies ENOENT as connection", () => {
    const e = new Error("spawn ENOENT");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });

  it("classifies timeout errors", () => {
    const e = new Error("Request timed out after 5000ms");
    const kind = classifyMcpError(e);
    assert.equal(kind, "timeout");
  });

  it("returns unknown for unrecognized errors", () => {
    const e = new Error("Some random error");
    const kind = classifyMcpError(e);
    assert.equal(kind, "unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/mcp/error-format.ts`**

```typescript
// src/mcp/error-format.ts

export type McpErrorKind =
  | "connection"
  | "timeout"
  | "tool_not_found"
  | "invalid_response"
  | "permission_denied"
  | "unknown";

export type McpError = {
  kind: McpErrorKind;
  server: string;
  cause?: string;
  tool?: string;
  timeoutMs?: number;
  detail?: string;
};

export function formatMcpError(err: McpError): string {
  switch (err.kind) {
    case "connection":
      return `MCP server "${err.server}" could not connect: ${err.cause ?? "unknown reason"}. Check that the server is running.`;
    case "timeout":
      return `MCP server "${err.server}" timed out after ${err.timeoutMs ?? "?"}ms. The server may be slow or unresponsive.`;
    case "tool_not_found":
      return `MCP server "${err.server}" does not provide tool "${err.tool}". Run \`alix mcp list\` to see available tools.`;
    case "invalid_response":
      return `MCP server "${err.server}" returned an invalid response: ${err.detail ?? "parse error"}. The server may be incompatible.`;
    case "permission_denied":
      return `MCP server "${err.server}" denied access. Check server permissions.`;
    case "unknown":
      return `MCP server "${err.server}" error: ${err.detail ?? err.cause ?? "unknown"}`;
  }
}

export function classifyMcpError(err: Error): McpErrorKind {
  const msg = err.message.toLowerCase();
  if (msg.includes("enoent") || msg.includes("econnrefused") || msg.includes("connect")) {
    return "connection";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("not found") || msg.includes("unknown tool")) {
    return "tool_not_found";
  }
  if (msg.includes("parse") || msg.includes("json") || msg.includes("invalid")) {
    return "invalid_response";
  }
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/mcp/error-format.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/error-format.ts tests/mcp/error-format.test.ts
git commit -m "feat(mcp): error normalization and classification (TDD)"
```

---

## Task 2: Create retry helper (TDD)

**Files:**
- Create: `tests/mcp/retry.test.ts`
- Create: `src/mcp/retry.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/mcp/retry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../src/mcp/retry.js";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return "ok"; });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  it("retries on connection error up to maxRetries", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return "ok";
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  it("throws after maxRetries exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error("ECONNREFUSED"); },
        { maxRetries: 2, baseDelayMs: 1 }
      ),
      /ECONNREFUSED/
    );
    assert.equal(calls, 3);  // initial + 2 retries
  });

  it("does not retry on non-retryable error", async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error("Invalid argument"); },
        { maxRetries: 3, baseDelayMs: 1, isRetryable: (e) => e.message.includes("ECONN") }
      ),
      /Invalid argument/
    );
    assert.equal(calls, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/mcp/retry.ts`**

```typescript
// src/mcp/retry.ts

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  isRetryable?: (err: Error) => boolean;
};

const defaultIsRetryable = (err: Error): boolean => {
  const msg = err.message.toLowerCase();
  return msg.includes("econnrefused") ||
         msg.includes("timeout") ||
         msg.includes("etimedout") ||
         msg.includes("econnreset");
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (attempt === options.maxRetries) break;
      if (!isRetryable(e)) break;

      const delay = options.baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/mcp/retry.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/retry.ts tests/mcp/retry.test.ts
git commit -m "feat(mcp): retry helper for transient failures (TDD)"
```

---

## Task 3: Create known MCP server registry (TDD)

**Files:**
- Create: `tests/mcp/server-registry.test.ts`
- Create: `src/mcp/server-registry.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/mcp/server-registry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_MCP_SERVERS, findServer } from "../../src/mcp/server-registry.js";

describe("KNOWN_MCP_SERVERS", () => {
  it("contains at least 5 well-known servers", () => {
    assert.ok(KNOWN_MCP_SERVERS.length >= 5);
  });

  it("each server has name, package, description", () => {
    for (const s of KNOWN_MCP_SERVERS) {
      assert.ok(s.name, "server must have name");
      assert.ok(s.package, "server must have package");
      assert.ok(s.description, "server must have description");
    }
  });

  it("includes github, filesystem, fetch", () => {
    const names = KNOWN_MCP_SERVERS.map((s) => s.name);
    assert.ok(names.includes("github"));
    assert.ok(names.includes("filesystem"));
    assert.ok(names.includes("fetch"));
  });
});

describe("findServer", () => {
  it("finds by name", () => {
    const s = findServer("github");
    assert.ok(s);
    assert.equal(s!.name, "github");
  });

  it("returns undefined for unknown", () => {
    assert.equal(findServer("nonexistent"), undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/mcp/server-registry.ts`**

```typescript
// src/mcp/server-registry.ts

export type KnownServer = {
  name: string;
  package: string;
  description: string;
  command: string;
  args: string[];
  homepage?: string;
};

export const KNOWN_MCP_SERVERS: KnownServer[] = [
  {
    name: "github",
    package: "@modelcontextprotocol/server-github",
    description: "GitHub API: issues, PRs, repos",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "filesystem",
    package: "@modelcontextprotocol/server-filesystem",
    description: "Filesystem operations: read, write, list",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "fetch",
    package: "@modelcontextprotocol/server-fetch",
    description: "HTTP fetch: GET, POST URLs",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "git",
    package: "@modelcontextprotocol/server-git",
    description: "Git operations: log, diff, status",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
  },
  {
    name: "postgres",
    package: "@modelcontextprotocol/server-postgres",
    description: "PostgreSQL: query, schema, list tables",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
  },
  {
    name: "puppeteer",
    package: "@modelcontextprotocol/server-puppeteer",
    description: "Browser automation via Puppeteer",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },
  {
    name: "slack",
    package: "@modelcontextprotocol/server-slack",
    description: "Slack: channels, messages, users",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
  },
];

export function findServer(name: string): KnownServer | undefined {
  return KNOWN_MCP_SERVERS.find((s) => s.name === name);
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server-registry.ts tests/mcp/server-registry.test.ts
git commit -m "feat(mcp): known server registry with 7 popular servers (TDD)"
```

---

## Task 4: Use error format in manager (optional integration)

**Files:**
- Modify: `src/mcp/manager.ts`

- [ ] **Step 1: Read current manager error handling**

```bash
grep -n "catch\|throw\|Error" src/mcp/manager.ts | head -20
```

- [ ] **Step 2: Wrap caught errors with `classifyMcpError` and `formatMcpError`**

Find the existing try/catch blocks in manager and add the new error format:

```typescript
import { classifyMcpError, formatMcpError, type McpError } from "./error-format.js";

// Example: in a connect() method
try {
  await this.connect(serverConfig);
} catch (e: any) {
  const kind = classifyMcpError(e);
  const mcpErr: McpError = { kind, server: serverConfig.name, cause: e.message };
  throw new Error(formatMcpError(mcpErr));
}
```

(Apply to 2-3 key error sites. Don't rewrite the whole file.)

- [ ] **Step 3: Verify build and tests**

- [ ] **Step 4: Commit**

```bash
git add src/mcp/manager.ts
git commit -m "refactor(mcp): use normalized error format in manager"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -5
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore(mcp): client improvements complete

- Error normalization and classification
- Retry helper for transient failures
- Registry of 7 popular MCP servers
- 11 new tests across 3 test files"
```

---

## Self-Review

- [x] Error format → Task 1
- [x] Retry helper → Task 2
- [x] Server registry → Task 3
- [x] Manager integration → Task 4 (optional)
- [x] Final verification → Task 5
- [x] TDD per superpowers:test-driven-development ✓

Plan length: 5 tasks, each 2-5 minutes. ✓
