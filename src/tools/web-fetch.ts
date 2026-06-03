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
        const truncated = content.length > maxLength ? content.slice(0, maxLength) : content;

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