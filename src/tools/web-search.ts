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