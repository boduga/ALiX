import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";

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
  /** Test seam: replaces the socket transport (default: pinned node:http/https). */
  transport?: WebFetchTransport;
};

export function defaultResolveHost(hostname: string): Promise<string[]> {
  return lookup(hostname, { all: true, verbatim: true }).then((records) => records.map(({ address }) => address));
}

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

/** Lowercase, de-bracket, and authorize a host against the domain allowlist. */
function normalizeAndAuthorizeHost(rawHost: string, allowDomains: string[]): string {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const normalizedDomains = allowDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, ""));
  if (normalizedDomains.length && !normalizedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`Domain is not allowed: ${host}`);
  }
  // Normalize obfuscated numeric IP literals (hex/octal/decimal inet_aton
  // forms) to canonical dotted quads BEFORE any check, so encodings like
  // 0x7f.0.0.1 or 2130706433 cannot slip past as "hostnames".
  const numeric = normalizeNumericHost(host);
  const effective = numeric ?? host;
  if (effective === "localhost" || effective.endsWith(".localhost")) throw new Error("Private network destinations are not allowed");
  return effective;
}

export async function validateNetworkHost(
  rawHost: string,
  allowDomains: string[],
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<string> {
  return (await resolveHostAddresses(rawHost, allowDomains, resolveHost)).host;
}

/**
 * Normalize an obfuscated numeric IPv4 literal to its canonical dotted
 * form (inet_aton semantics: decimal, 0x-hex, 0-octal, and 1-4 part forms).
 * Returns null when the host is not a numeric literal (regular hostnames
 * and already-canonical IPs pass through untouched).
 */
export function normalizeNumericHost(rawHost: string): string | null {
  const host = rawHost.toLowerCase();
  if (isIP(host)) return null;
  const parsePart = (part: string): number | null => {
    if (!part) return null;
    if (/^0x[0-9a-f]+$/.test(part)) return Number.parseInt(part, 16);
    if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
    if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
    return null;
  };
  const toQuad = (n: number): string =>
    [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  // Single-number 32-bit form: decimal or hex (a leading-0 decimal like
  // "0177000001" would be ambiguous with octal — treat as decimal only
  // when it contains 8/9, else octal, matching getaddrinfo).
  if (/^(?:0x[0-9a-f]+|\d+)$/.test(host)) {
    let n: number;
    if (host.startsWith("0x")) {
      n = Number.parseInt(host, 16);
    } else if (/^0\d+$/.test(host) && !/[89]/.test(host)) {
      n = Number.parseInt(host, 8);
    } else {
      n = Number.parseInt(host, 10);
    }
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    return toQuad(n);
  }
  const parts = host.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = parsePart(part);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    nums.push(n);
  }
  // inet_aton: the last part absorbs the remaining bytes.
  if (parts.length === 4) {
    if (nums.some((n) => n > 0xff)) return null;
    return nums.join(".");
  }
  if (parts.length === 3) {
    const [a, b, c] = nums;
    if (a! > 0xff || b! > 0xff || c! > 0xffff) return null;
    return `${a}.${b}.${(c! >> 8) & 0xff}.${c! & 0xff}`;
  }
  const [a, b] = nums;
  if (a! > 0xff || b! > 0xffffff) return null;
  return `${a}.${(b! >> 16) & 0xff}.${(b! >> 8) & 0xff}.${b! & 0xff}`;
}

/**
 * Validate a host and return every validated (public) address it resolves
 * to. The caller must connect only to these addresses — never re-resolve —
 * so a DNS change between validation and connect (rebinding) cannot divert
 * the connection to a private destination.
 */
export async function resolveHostAddresses(
  rawHost: string,
  allowDomains: string[],
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<{ host: string; addresses: string[] }> {
  const host = normalizeAndAuthorizeHost(rawHost, allowDomains);
  // Single resolution: the caller must connect only to these addresses.
  const addresses = isIP(host) ? [host] : await resolveHost(host);
  if (!addresses.length || addresses.some((address) => isPrivateNetworkAddress(address))) {
    throw new Error("Private network destinations are not allowed");
  }
  return { host, addresses };
}

export async function validateNetworkUrl(raw: string, allowDomains: string[], resolveHost: (hostname: string) => Promise<string[]>): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://");
  await validateNetworkHost(url.hostname, allowDomains, resolveHost);
  return url;
}

/**
 * A DNS lookup pinned to already-validated addresses. The hostname argument
 * is ignored: the connection can only go to an address that passed
 * validation, so a DNS change after validation (rebinding) has no effect.
 */
export type PinnedLookupOptions = { family?: number; all?: boolean; hints?: number } | number;

export type PinnedLookup = (
  hostname: string,
  options: PinnedLookupOptions,
  callback: (
    err: Error | null,
    address: string | Array<{ address: string; family: number }>,
    family: number,
  ) => void,
) => void;

export function createPinnedLookup(addresses: string[]): PinnedLookup {
  const valid = addresses.filter((address) => isIP(address) !== 0);
  return (_hostname, options, callback) => {
    const opts = typeof options === "number" ? { family: options } : (options ?? {});
    const family = opts.family ?? 0;
    // node:http passes { all: true } and expects an address array back.
    const matches = valid.filter((address) => family === 0 || isIP(address) === family);
    const pick = matches[0] ?? valid[0];
    if (!pick) {
      callback(Object.assign(new Error("No validated address available"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (opts.all) {
      const list = (matches.length ? matches : [pick]).map((address) => ({ address, family: isIP(address) }));
      callback(null, list, isIP(pick));
      return;
    }
    callback(null, pick, isIP(pick));
  };
}

export type PinnedRequestInit = {
  headers: Record<string, string>;
  lookup: PinnedLookup;
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
};

export type PinnedResponse = {
  status: number;
  statusText: string;
  contentType: string;
  location: string | null;
  contentLength: number | null;
  body: Buffer;
};

export type WebFetchTransport = (url: URL, init: PinnedRequestInit) => Promise<PinnedResponse>;

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Default socket transport: node:http/https with the pinned lookup. */
export function defaultTransport(url: URL, init: PinnedRequestInit): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${init.timeoutMs}ms`));
    }, init.timeoutMs);
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const impl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = impl(
      url,
      {
        method: "GET",
        headers: init.headers,
        lookup: init.lookup as unknown as NonNullable<HttpsRequestOptions["lookup"]>,
        signal: init.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          if (bytes < init.maxBytes) {
            chunks.push(chunk);
            bytes += chunk.length;
          }
        });
        res.on("end", () =>
          done(() =>
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              contentType: headerValue(res.headers["content-type"]),
              location: headerValue(res.headers["location"]) || null,
              contentLength: (() => {
                const n = Number(headerValue(res.headers["content-length"]));
                return Number.isSafeInteger(n) && n >= 0 ? n : null;
              })(),
              body: Buffer.concat(chunks).slice(0, init.maxBytes),
            }),
          ),
        );
        res.on("error", (err) => done(() => reject(err)));
      },
    );
    req.on("error", (err) => done(() => reject(err)));
    req.end();
  });
}

export type FetchPinnedOptions = {
  allowDomains?: string[];
  timeoutMs?: number;
  /** Body cap in bytes (default 1_000_000). */
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Default ["http:", "https:"] — skills pass ["https:"] to stay https-only. */
  protocols?: string[];
  resolveHost?: (hostname: string) => Promise<string[]>;
  transport?: WebFetchTransport;
};

export type FetchPinnedResult = {
  status: number;
  statusText: string;
  url: string;
  contentType: string;
  contentLength: number | null;
  body: Buffer;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET a URL with per-hop validation and DNS-rebinding protection: every
 * hostname (initial + each redirect) is resolved exactly once, and the
 * socket connects only to the validated addresses via a pinned lookup.
 */
export async function fetchPinned(rawUrl: string, options: FetchPinnedOptions = {}): Promise<FetchPinnedResult> {
  const protocols = options.protocols ?? ["http:", "https:"];
  const transport = options.transport ?? defaultTransport;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const headers = options.headers ?? {};
  const allowDomains = (options.allowDomains ?? []).map((d) => d.toLowerCase().replace(/^\*\./, ""));
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = new URL(rawUrl);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!protocols.includes(current.protocol)) throw new Error(`URL must use ${protocols.join(" or ")}`);
      const { addresses } = await resolveHostAddresses(current.hostname, allowDomains, resolveHost);
      const res = await transport(current, {
        headers,
        lookup: createPinnedLookup(addresses),
        signal: controller.signal,
        timeoutMs,
        maxBytes,
      });
      if (!REDIRECT_STATUSES.has(res.status)) {
        return {
          status: res.status,
          statusText: res.statusText,
          url: current.toString(),
          contentType: res.contentType,
          contentLength: res.contentLength,
          body: res.body,
        };
      }
      if (!res.location || redirects === 5) throw new Error("Too many or invalid redirects");
      current = new URL(res.location, current);
    }
    throw new Error("Too many or invalid redirects");
  } finally {
    clearTimeout(timer);
  }
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
      try {
        const res = await fetchPinned(args.url, {
          allowDomains: options.allowDomains,
          timeoutMs: options.timeoutMs ?? 15_000,
          maxBytes: maxLength * 4,
          headers: { "User-Agent": "ALiX/0.1 (local coding agent)" },
          resolveHost: options.resolveHost,
          transport: options.transport,
        });

        if (res.status < 200 || res.status >= 300) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }

        const raw = res.body.toString("utf-8");
        const isHtml = res.contentType.includes("text/html") || res.contentType.includes("application/xhtml");
        const content = isHtml ? stripHtml(raw) : raw;
        const truncated = content.length > maxLength ? content.slice(0, maxLength) : content;

        return {
          ok: true,
          data: { content: truncated, url: res.url, status: res.status },
        };
      } catch (e: any) {
        return { ok: false, error: `Network error: ${e.message}` };
      }
    },
  };
}
