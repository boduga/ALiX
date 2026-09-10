import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

export type WebFetchOptions = {
  allowDomains?: string[];
  timeoutMs?: number;
  resolveHost?: (hostname: string) => Promise<string[]>;
};

export function isPrivateNetworkAddress(address: string): boolean {
  address = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.startsWith("::ffff:")) return isPrivateNetworkAddress(address.slice(7));
  if (isIP(address) === 6) {
    if (address === "::1" || address === "::" || address.startsWith("2001:db8:")) return true;
    // Only globally routable unicast (2000::/3) may leave the process.
    return !/^[23][0-9a-f]{3}:/.test(address);
  }
  if (isIP(address) !== 4) return true;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function validateNetworkHost(
  rawHost: string,
  allowDomains: string[],
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<string> {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const normalizedDomains = allowDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, ""));
  if (normalizedDomains.length && !normalizedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`Domain is not allowed: ${host}`);
  }
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Private network destinations are not allowed");
  const addresses = isIP(host) ? [host] : await resolveHost(host);
  if (!addresses.length || addresses.some((address) => isPrivateNetworkAddress(address))) {
    throw new Error("Private network destinations are not allowed");
  }
  return host;
}

export async function validateNetworkUrl(raw: string, allowDomains: string[], resolveHost: (hostname: string) => Promise<string[]>): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://");
  await validateNetworkHost(url.hostname, allowDomains, resolveHost);
  return url;
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: bytes < maxBytes });
    }
  } finally {
    if (bytes >= maxBytes) await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

export function webFetchTool(options: WebFetchOptions = {}) {
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
      const maxLength = Math.max(1, Math.min(args.maxLength ?? 10000, 1_000_000));
      const allowDomains = (options.allowDomains ?? []).map((d) => d.toLowerCase().replace(/^\*\./, ""));
      const resolveHost = options.resolveHost ?? (async (host: string) => (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

      try {
        let url = await validateNetworkUrl(args.url, allowDomains, resolveHost);
        let res: Response | undefined;
        for (let redirects = 0; redirects <= 5; redirects++) {
          res = await fetch(url, {
            headers: { "User-Agent": "ALiX/0.1 (local coding agent)" },
            redirect: "manual",
            signal: controller.signal,
          });
          if (![301, 302, 303, 307, 308].includes(res.status)) break;
          const location = res.headers.get("location");
          if (!location || redirects === 5) throw new Error("Too many or invalid redirects");
          url = await validateNetworkUrl(new URL(location, url).toString(), allowDomains, resolveHost);
        }
        if (!res) throw new Error("No response received");

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }

        const contentType = res.headers.get("content-type") ?? "";
        const raw = await readBounded(res, maxLength * 4);
        const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
        const content = isHtml ? stripHtml(raw) : raw;
        const truncated = content.length > maxLength ? content.slice(0, maxLength) : content;

        return {
          ok: true,
          data: { content: truncated, url: url.toString(), status: res.status },
        };
      } catch (e: any) {
        return { ok: false, error: `Network error: ${e.message}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
