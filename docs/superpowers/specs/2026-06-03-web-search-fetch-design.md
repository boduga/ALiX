# Web Search & Fetch Tools Design

**Date:** 2026-06-03
**Status:** Draft
**Source:** User request — local LLM can't answer questions about current events

## Motivation

ALiX currently has no web access tools. When using a local LLM (like Qwen2.5-Coder-7B) with a knowledge cutoff of ~2023, the agent cannot answer questions about:
- Current events (politics, news)
- Latest software versions
- Recent documentation
- Real-time data (weather, stock prices)

This is especially limiting for the local-llama spec, where the model has no fallback to fresh information.

## Goals

1. **Add `web_search` tool** — takes a query, returns top search results
2. **Add `web_fetch` tool** — takes a URL, returns page content
3. **Works with both local-llama (grammar-constrained) and cloud providers**
4. **No new dependencies** — use Node's built-in `fetch`
5. **Brave Search API as backend** (free tier: 2000 queries/month, no credit card)

## Non-Goals

- Web scraping beyond simple content extraction
- Search engine alternatives (Google, Bing, DuckDuckGo) — Brave is enough
- Caching/rate limiting — user can add later
- Authentication (login-walled pages)

## Architecture

### New Files

- `src/tools/web-search.ts` — `web_search` tool (~80 lines)
- `src/tools/web-fetch.ts` — `web_fetch` tool (~80 lines)
- `tests/tools/web-search.test.ts` — TDD tests with mocked fetch
- `tests/tools/web-fetch.test.ts` — TDD tests with mocked fetch

### Modified Files

- `src/tools/tool-router.ts` — Register the 2 new tools
- `docs/local-llama-setup.md` — Update with Brave API key instructions
- `README.md` — Add "Web Tools" section

### Tool Schemas

**`web_search`**:
```json
{
  "name": "web_search",
  "description": "Search the web for current information. Use when you need recent data or facts beyond your training cutoff.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search query"
      },
      "count": {
        "type": "integer",
        "description": "Number of results to return (1-10, default 5)"
      }
    },
    "required": ["query"]
  }
}
```

**`web_fetch`**:
```json
{
  "name": "web_fetch",
  "description": "Fetch a URL and return its text content. Use after web_search to read full articles.",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "The URL to fetch (must be http:// or https://)"
      },
      "maxLength": {
        "type": "integer",
        "description": "Maximum content length in characters (default 10000)"
      }
    },
    "required": ["url"]
  }
}
```

### Tool Implementation Pattern

Both tools follow the same pattern as existing tools in `src/tools/`:

```typescript
export function webSearchTool() {
  return {
    name: "web_search",
    description: "...",
    input_schema: { ... },
    async execute(args) {
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        return { ok: false, error: "BRAVE_API_KEY env var not set" };
      }
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${args.count ?? 5}`,
        { headers: { "X-Subscription-Token": apiKey, "Accept": "application/json" } }
      );
      if (!res.ok) {
        return { ok: false, error: `Brave API error: ${res.status}` };
      }
      const data = await res.json();
      const results = data.web?.results ?? [];
      return {
        ok: true,
        data: {
          results: results.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.description,
          })),
        },
      };
    },
  };
}
```

## Data Flow

```
Agent: "Who is the president of Nigeria?"
  ↓
Model calls web_search("current president Nigeria")
  ↓
ALiX calls Brave API
  ↓
Returns top 5 results with titles, URLs, snippets
  ↓
Model reads snippets, possibly calls web_fetch on a URL
  ↓
Model synthesizes answer: "Bola Tinubu is the current president"
```

## Edge Cases

1. **Missing API key** → Tool returns error message
2. **Network failure** → Tool catches and returns error
3. **Rate limited (429)** → Tool returns 429 error
4. **Invalid URL** → `web_fetch` validates http:// or https:// prefix
5. **HTML content** → `web_fetch` strips tags, returns plain text
6. **Very long content** → `web_fetch` truncates to `maxLength`
7. **Privacy** → URLs logged in event log (user can opt out)

## Testing Strategy

### Unit tests (TDD, mocked fetch)

```
tests/tools/web-search.test.ts
- "returns top results from Brave API"
- "respects count parameter"
- "uses API key from env"
- "returns error when API key missing"
- "returns error on API failure"
- "URL-encodes query"
```

```
tests/tools/web-fetch.test.ts
- "fetches URL and returns text content"
- "strips HTML tags"
- "respects maxLength"
- "validates URL scheme"
- "returns error on fetch failure"
- "handles 404 gracefully"
```

## Setup Instructions

```bash
# Get free Brave Search API key
# https://api.search.brave.com/app/dashboard

# Set the env var
export BRAVE_API_KEY="BSA..."

# Update ALiX config
# (no config change needed — env var is auto-detected)
```

## Success Criteria

- [ ] `web_search` tool implemented with TDD
- [ ] `web_fetch` tool implemented with TDD
- [ ] Both tools registered with tool router
- [ ] Tests pass with mocked fetch
- [ ] Manual test with real Brave API key works
- [ ] Local-llama Q&A about current events works (e.g., "current president")

## Out of Scope

- Caching search results
- Multi-engine search (Google, Bing)
- Content extraction libraries (Mozilla Readability, etc.)
