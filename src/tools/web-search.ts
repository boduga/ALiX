import { getSavedApiKey, getSearchConfig } from "../cli/helpers/api-keys.js";

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
      const count = Math.min(Math.max(args.count ?? 5, 1), 10);
      const searchConfig = await getSearchConfig();
      if (searchConfig.provider === "searxng") {
        return searchSearxng(args.query, count, searchConfig.searxngBaseUrl, searchConfig.searxngEngines);
      }
      return searchBrave(args.query, count);
    },
  };
}

async function searchBrave(query: string, count: number): Promise<WebSearchResult> {
  const apiKey = await getSavedApiKey("brave");
  if (!apiKey) {
    return { ok: false, error: "Brave API key not configured. Store it with: alix credential set brave apiKey <value> (get a free key at https://api.search.brave.com/app/dashboard)" };
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

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
}

/**
 * Self-hosted SearXNG backend (JSON API: GET {base}/search?q=..&format=json).
 * Needs `format: [html, json]` enabled in the instance's settings.yml.
 * Uses plain fetch (no SSRF domain guard) so LAN/private instances work.
 */
async function searchSearxng(query: string, count: number, baseUrl: string | undefined, engines?: string): Promise<WebSearchResult> {
  if (!baseUrl) {
    return { ok: false, error: 'SearXNG base URL not configured. Add "search": { "provider": "searxng", "searxngBaseUrl": "http://<host>:<port>" } to ~/.config/alix/config.json' };
  }

  // Optional engine pin (e.g. "bing,wikipedia") for instances whose other
  // upstreams are throttled. Omit to use the instance defaults.
  const engineParam = engines ? `&engines=${encodeURIComponent(engines)}` : "";
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json${engineParam}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const hint = res.status === 403
        ? " (enable `format: [html, json]` under `search.formats` in the instance settings.yml, then restart)"
        : "";
      return { ok: false, error: `SearXNG error ${res.status}: ${await res.text().catch(() => "unknown")}${hint}` };
    }
    const data = await res.json() as any;
    const results = (Array.isArray(data.results) ? data.results : []).slice(0, count).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: String(r.content ?? ""),
    }));
    return { ok: true, data: { results } };
  } catch (e: any) {
    return { ok: false, error: `Network error: ${e.message}` };
  }
}