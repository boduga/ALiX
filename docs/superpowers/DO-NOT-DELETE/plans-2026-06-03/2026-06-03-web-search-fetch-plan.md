# Web Search & Fetch Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `web_search` and `web_fetch` tools to ALiX so the agent can fetch current information, especially when using local LLMs with old knowledge cutoffs.

**Architecture:** Two new tool files using Node's built-in `fetch`. Tests use mocked fetch responses. Registered in `src/tools/tool-router.ts`.

**Tech Stack:** TypeScript, `node:test`, Node's built-in `fetch`.

---

## File Structure

**New files:**
- `src/tools/web-search.ts` — `web_search` tool
- `src/tools/web-fetch.ts` — `web_fetch` tool
- `tests/tools/web-search.test.ts` — Mocked tests
- `tests/tools/web-fetch.test.ts` — Mocked tests

**Modified files:**
- `src/tools/tool-router.ts` — Register 2 new tools

---

## Task 1: Create `web_search` tool (TDD)

**Files:**
- Create: `tests/tools/web-search.test.ts`
- Create: `src/tools/web-search.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/tools/web-search.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webSearchTool } from "../../src/tools/web-search.js";

describe("webSearchTool", () => {
  let originalFetch: typeof fetch;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalKey = process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) {
      process.env.BRAVE_API_KEY = originalKey;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
  });

  it("returns a tool definition", () => {
    const tool = webSearchTool();
    assert.equal(tool.name, "web_search");
    assert.ok(tool.description);
    assert.ok(tool.input_schema);
  });

  it("returns top results from Brave API", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    const mockResults = {
      web: {
        results: [
          { title: "First", url: "https://example.com/1", description: "First result" },
          { title: "Second", url: "https://example.com/2", description: "Second result" },
        ],
      },
    };
    globalThis.fetch = (async (url, init) => {
      assert.ok(String(url).includes("api.search.brave.com"));
      assert.ok(String(url).includes("q=hello"));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["X-Subscription-Token"], "test-key");
      return new Response(JSON.stringify(mockResults), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    const result = await tool.execute({ query: "hello" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).results.length, 2);
    assert.equal((result.data as any).results[0].title, "First");
  });

  it("respects count parameter", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = (async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    await tool.execute({ query: "test", count: 10 });
    assert.ok(capturedUrl.includes("count=10"));
  });

  it("returns error when API key missing", async () => {
    delete process.env.BRAVE_API_KEY;
    const tool = webSearchTool();
    const result = await tool.execute({ query: "test" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("BRAVE_API_KEY"));
  });

  it("returns error on API failure", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    globalThis.fetch = (async () => {
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;

    const tool = webSearchTool();
    const result = await tool.execute({ query: "test" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("429"));
  });

  it("URL-encodes the query", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = (async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    await tool.execute({ query: "hello world & special chars?" });
    assert.ok(capturedUrl.includes("hello%20world"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

Expected: Module not found.

- [ ] **Step 3: Implement `src/tools/web-search.ts`**

```typescript
// src/tools/web-search.ts

export type WebSearchArgs = {
  query: string;
  count?: number;
};

export type WebSearchResult = {
  ok: boolean;
  error?: string;
  data?: {
    results: Array<{ title: string; url: string; snippet: string }>;
  };
};

export function webSearchTool() {
  return {
    name: "web_search",
    description: "Search the web for current information. Use when you need recent data or facts beyond your training cutoff (e.g. current events, latest versions, recent documentation).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "integer", description: "Number of results (1-10, default 5)" },
      },
      required: ["query"],
    },
    async execute(args: WebSearchArgs): Promise<WebSearchResult> {
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        return { ok: false, error: "BRAVE_API_KEY env var not set. Get a free key at https://api.search.brave.com/app/dashboard" };
      }

      const count = Math.min(Math.max(args.count ?? 5, 1), 10);
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}`;

      try {
        const res = await fetch(url, {
          headers: {
            "X-Subscription-Token": apiKey,
            "Accept": "application/json",
          },
        });

        if (!res.ok) {
          return { ok: false, error: `Brave API error ${res.status}: ${await res.text().catch(() => "unknown")}` };
        }

        const data = await res.json() as any;
        const results = (data.web?.results ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));

        return { ok: true, data: { results } };
      } catch (e: any) {
        return { ok: false, error: `Network error: ${e.message}` };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/tools/web-search.test.js 2>&1 | tail -5
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-search.ts tests/tools/web-search.test.ts
git commit -m "feat(tools): add web_search tool (Brave Search API)"
```

---

## Task 2: Create `web_fetch` tool (TDD)

**Files:**
- Create: `tests/tools/web-fetch.test.ts`
- Create: `src/tools/web-fetch.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/tools/web-fetch.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webFetchTool } from "../../src/tools/web-fetch.js";

describe("webFetchTool", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a tool definition", () => {
    const tool = webFetchTool();
    assert.equal(tool.name, "web_fetch");
    assert.ok(tool.description);
  });

  it("fetches URL and returns text content", async () => {
    globalThis.fetch = (async (url) => {
      assert.ok(String(url).startsWith("https://"));
      return new Response("Hello world content", { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).content, "Hello world content");
  });

  it("strips HTML tags", async () => {
    const html = "<html><body><h1>Title</h1><p>Paragraph text</p></body></html>";
    globalThis.fetch = (async () => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal((result.data as any).content.trim(), "Title Paragraph text");
  });

  it("respects maxLength", async () => {
    globalThis.fetch = (async () => {
      return new Response("a".repeat(1000), { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com", maxLength: 100 });
    const content = (result.data as any).content as string;
    assert.ok(content.length <= 100);
  });

  it("validates URL scheme", async () => {
    const tool = webFetchTool();
    const result = await tool.execute({ url: "ftp://example.com" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("http"));
  });

  it("returns error on 404", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com/missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("404"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/tools/web-fetch.ts`**

```typescript
// src/tools/web-fetch.ts

export type WebFetchArgs = {
  url: string;
  maxLength?: number;
};

export type WebFetchResult = {
  ok: boolean;
  error?: string;
  data?: { content: string; url: string; status: number };
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function webFetchTool() {
  return {
    name: "web_fetch",
    description: "Fetch a URL and return its text content. Use after web_search to read full articles. HTML is automatically stripped.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (must be http:// or https://)" },
        maxLength: { type: "integer", description: "Maximum content length in characters (default 10000)" },
      },
      required: ["url"],
    },
    async execute(args: WebFetchArgs): Promise<WebFetchResult> {
      if (!args.url.startsWith("http://") && !args.url.startsWith("https://")) {
        return { ok: false, error: "URL must start with http:// or https://" };
      }

      const maxLength = args.maxLength ?? 10000;

      try {
        const res = await fetch(args.url, {
          headers: { "User-Agent": "ALiX/0.1 (local coding agent)" },
        });

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }

        const contentType = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
        const content = isHtml ? stripHtml(raw) : raw;
        const truncated = content.length > maxLength ? content.slice(0, maxLength) + "..." : content;

        return {
          ok: true,
          data: { content: truncated, url: args.url, status: res.status },
        };
      } catch (e: any) {
        return { ok: false, error: `Network error: ${e.message}` };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/tools/web-fetch.test.js 2>&1 | tail -5
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
git commit -m "feat(tools): add web_fetch tool with HTML stripping"
```

---

## Task 3: Register tools in tool router

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Read current router**

```bash
grep -n "import\|register\|tool-name" src/tools/tool-router.ts | head -20
```

- [ ] **Step 2: Add imports and registrations**

Add:
```typescript
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
```

And in the tool registration list:
```typescript
register(webSearchTool());
register(webFetchTool());
```

(Adapt to the router's actual pattern.)

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/tool-router.ts
git commit -m "feat(tools): register web_search and web_fetch"
```

---

## Task 4: Update docs and README

**Files:**
- Modify: `README.md`
- Modify: `docs/local-llama-setup.md` (if exists)

- [ ] **Step 1: Add Web Tools section to README**

In `README.md`, add:

```markdown
## Web Tools

ALiX can search the web and fetch page content for current information.

### Setup

Get a free Brave Search API key: https://api.search.brave.com/app/dashboard

```bash
export BRAVE_API_KEY="BSA..."
```

The agent can then call:
- `web_search("current events topic")` — returns top 5 results
- `web_fetch("https://article-url")` — returns article text (HTML stripped)

Especially useful for local LLMs with old knowledge cutoffs.
```

- [ ] **Step 2: Commit**

```bash
git add README.md docs/local-llama-setup.md 2>/dev/null
git commit -m "docs: document web_search and web_fetch tools"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat(tools): web_search and web_fetch complete

- web_search: Brave Search API integration
- web_fetch: URL fetching with HTML stripping
- 12 new tests, all pass
- README updated with setup instructions
- Especially useful for local LLMs with old knowledge cutoffs"
```

---

## Self-Review

- [x] web_search tool with TDD → Task 1
- [x] web_fetch tool with TDD → Task 2
- [x] Tool router integration → Task 3
- [x] Documentation → Task 4
- [x] Final verification → Task 5
- [x] TDD throughout
- [x] Mocked tests, real verification deferred to user (Brave API key)

Plan length: 5 tasks, each 2-5 minutes. ✓
