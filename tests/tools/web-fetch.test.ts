import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  webFetchTool,
  normalizeNumericHost,
  createPinnedLookup,
  type WebFetchTransport,
  type PinnedResponse,
} from "../../src/tools/web-fetch.js";

const PUBLIC_RESOLVE = async () => ["93.184.216.34"];

function textRes(text: string, status = 200, contentType = "text/plain"): PinnedResponse {
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    contentType,
    location: null,
    contentLength: text.length,
    body: Buffer.from(text),
  };
}

function recordingTransport(
  respond: (url: URL) => PinnedResponse,
  seen: Seen,
): WebFetchTransport {
  return async (url, init) => {
    seen.push({ url: url.toString(), lookup: init.lookup });
    return respond(url);
  };
}

type SeenLookup = Parameters<WebFetchTransport>[1]["lookup"];
type Seen = Array<{ url: string; lookup: SeenLookup }>;

describe("webFetchTool", () => {
  it("returns a tool definition", () => {
    const tool = webFetchTool({ resolveHost: PUBLIC_RESOLVE });
    assert.equal(tool.name, "web_fetch");
    assert.ok(tool.description);
  });

  it("fetches URL and returns text content", async () => {
    const seen: Seen = [];
    const tool = webFetchTool({
      resolveHost: PUBLIC_RESOLVE,
      transport: recordingTransport(() => textRes("Hello world content"), seen),
    });
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).content, "Hello world content");
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.url.startsWith("https://"));
  });

  it("strips HTML tags", async () => {
    const html = "<html><body><h1>Title</h1><p>Paragraph text</p></body></html>";
    const tool = webFetchTool({
      resolveHost: PUBLIC_RESOLVE,
      transport: recordingTransport(() => textRes(html, 200, "text/html"), []),
    });
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal((result.data as any).content.trim(), "Title Paragraph text");
  });

  it("respects maxLength", async () => {
    const tool = webFetchTool({
      resolveHost: PUBLIC_RESOLVE,
      transport: recordingTransport(() => textRes("a".repeat(1000)), []),
    });
    const result = await tool.execute({ url: "https://example.com", maxLength: 100 });
    const content = (result.data as any).content as string;
    assert.ok(content.length <= 100);
  });

  it("validates URL scheme", async () => {
    const tool = webFetchTool({ resolveHost: PUBLIC_RESOLVE });
    const result = await tool.execute({ url: "ftp://example.com" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("http"));
  });

  it("blocks loopback and private-network destinations before connect", async () => {
    const seen: Seen = [];
    const tool = webFetchTool({
      transport: recordingTransport(() => textRes("no"), seen),
    });
    for (const url of ["http://127.0.0.1/admin", "http://localhost/admin", "http://169.254.169.254/latest/meta-data/"]) {
      const result = await tool.execute({ url });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Private network/);
    }
    assert.equal(seen.length, 0);
  });

  it("enforces configured domain allowlist", async () => {
    const tool = webFetchTool({ allowDomains: ["allowed.example"], resolveHost: PUBLIC_RESOLVE });
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not allowed/);
  });

  it("returns error on 404", async () => {
    const tool = webFetchTool({
      resolveHost: PUBLIC_RESOLVE,
      transport: recordingTransport(() => textRes("not found", 404), []),
    });
    const result = await tool.execute({ url: "https://example.com/missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("404"));
  });

  it("follows redirects and validates each hop", async () => {
    const seen: Seen = [];
    const tool = webFetchTool({
      resolveHost: PUBLIC_RESOLVE,
      transport: recordingTransport(
        (url) => url.pathname === "/start"
          ? { ...textRes("", 302), location: "https://example.com/final" }
          : textRes("landed"),
        seen,
      ),
    });
    const result = await tool.execute({ url: "https://example.com/start" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).content, "landed");
    assert.equal(seen.length, 2);
  });

  it("blocks redirects to private destinations", async () => {
    const seen: Seen = [];
    const resolveHost = async (host: string) => (host === "example.com" ? ["93.184.216.34"] : ["10.9.9.9"]);
    const tool = webFetchTool({
      resolveHost,
      transport: recordingTransport(
        () => ({ ...textRes("", 302), location: "http://evil.test/" }),
        seen,
      ),
    });
    const result = await tool.execute({ url: "https://example.com/start" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Private network/);
    assert.equal(seen.length, 1);
  });

  it("pins the connection to the validated address across DNS rebinds", async () => {
    // First resolution answers public; every later resolution answers
    // private (simulating a rebind between validation and connect).
    let calls = 0;
    const resolveHost = async (_host: string) => (++calls === 1 ? ["93.184.216.34"] : ["10.9.9.9"]);
    const dialed: string[] = [];
    const transport: WebFetchTransport = async (url, init) => {
      const address = await new Promise<string>((resolve, reject) =>
        init.lookup(url.hostname, {}, (err, addr) => {
          if (err) reject(err);
          else if (typeof addr === "string") resolve(addr);
          else reject(new Error("expected a single address"));
        }),
      );
      dialed.push(address);
      return textRes("hello");
    };
    const tool = webFetchTool({ resolveHost, transport });
    const first = await tool.execute({ url: "https://rebind.test/" });
    assert.equal(first.ok, true);
    // The socket went to the validated public address even though DNS now
    // answers private.
    assert.deepEqual(dialed, ["93.184.216.34"]);
    assert.deepEqual(await resolveHost("rebind.test"), ["10.9.9.9"]);
    // A fresh request re-validates and is blocked before connecting.
    dialed.length = 0;
    const second = await tool.execute({ url: "https://rebind.test/" });
    assert.equal(second.ok, false);
    assert.match(second.error ?? "", /Private network/);
    assert.equal(dialed.length, 0);
  });
});

describe("normalizeNumericHost", () => {
  it("passes through hostnames and canonical IPs", () => {
    assert.equal(normalizeNumericHost("example.com"), null);
    assert.equal(normalizeNumericHost("127.0.0.1"), null);
    assert.equal(normalizeNumericHost("::1"), null);
    assert.equal(normalizeNumericHost("evil.test"), null);
  });

  it("normalizes hex, octal, and decimal loopback encodings", () => {
    assert.equal(normalizeNumericHost("0x7f.0.0.1"), "127.0.0.1");
    assert.equal(normalizeNumericHost("0x7f000001"), "127.0.0.1");
    assert.equal(normalizeNumericHost("2130706433"), "127.0.0.1");
    assert.equal(normalizeNumericHost("0177.0.0.1"), "127.0.0.1");
    assert.equal(normalizeNumericHost("017700000001"), "127.0.0.1");
  });

  it("normalizes two- and three-part inet_aton forms", () => {
    assert.equal(normalizeNumericHost("10.1"), "10.0.0.1");
    assert.equal(normalizeNumericHost("192.168.1"), "192.168.0.1");
  });

  it("rejects out-of-range numeric forms", () => {
    assert.equal(normalizeNumericHost("999.999.999.999"), null);
    assert.equal(normalizeNumericHost("0x1ffffffff"), null);
    assert.equal(normalizeNumericHost("1.2.3.4.5"), null);
  });
});

describe("createPinnedLookup", () => {
  function dial(lookup: ReturnType<typeof createPinnedLookup>, host: string, family = 0): Promise<string> {
    return new Promise((resolve, reject) =>
      lookup(host, { family }, (err, addr) => {
        if (err) reject(err);
        else if (typeof addr === "string") resolve(addr);
        else reject(new Error("expected a single address"));
      }),
    );
  }

  it("always returns a validated address regardless of hostname", async () => {
    const lookup = createPinnedLookup(["93.184.216.34"]);
    assert.equal(await dial(lookup, "rebound.test"), "93.184.216.34");
    assert.equal(await dial(lookup, "anything.else"), "93.184.216.34");
  });

  it("respects the requested address family when available", async () => {
    const lookup = createPinnedLookup(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    assert.equal(await dial(lookup, "x.test", 6), "2606:2800:220:1:248:1893:25c8:1946");
    assert.equal(await dial(lookup, "x.test", 4), "93.184.216.34");
  });

  it("fails closed when no validated address exists", async () => {
    const lookup = createPinnedLookup([]);
    await assert.rejects(dial(lookup, "x.test"), /No validated address/);
  });

  it("answers all:true lookups with an address array (node:http interop)", async () => {
    const lookup = createPinnedLookup(["93.184.216.34"]);
    const list = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) =>
      lookup("x.test", { all: true }, (err, addr) => (err ? reject(err) : resolve(addr as Array<{ address: string; family: number }>))),
    );
    assert.deepEqual(list, [{ address: "93.184.216.34", family: 4 }]);
  });
});
