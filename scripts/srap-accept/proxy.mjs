#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — production-mode TLS proxy.
 *
 * Terminates HTTPS on a loopback listener and forwards plain HTTP to the
 * Inspector. It models the reviewed production posture from
 * `docs/2026-10-16-srap-g3-acceptance-fixture.md` §5.2:
 *
 *   - binds ONLY to 127.0.0.1;
 *   - removes ALL client-originated `Forwarded` / `X-Forwarded-*` / `X-Real-IP`
 *     / `Via` headers, then writes exactly ONE canonical trusted value,
 *     `X-Forwarded-Proto: https`;
 *   - never sets `-k`/skip-verify behaviour on the client side (the client uses
 *     `--cacert` against the fixture CA).
 *
 * This is inert fixture infrastructure: it carries no product logic and is
 * never imported by `src/**`.
 *
 * Env:
 *   SRAP_ACCEPT_ROOT   fixture root (required) — cert/key read from `$ROOT/tls`
 *   SRAP_PROXY_PORT    listen port (default 4143)
 *   SRAP_UPSTREAM_HOST upstream host (default 127.0.0.1)
 *   SRAP_UPSTREAM_PORT upstream port (default 4139)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";

const ROOT = process.env.SRAP_ACCEPT_ROOT;
if (!ROOT || !ROOT.startsWith("/")) {
  console.error("SRAP_ACCEPT_ROOT must be an absolute path (fixture root)");
  process.exit(1);
}
const TLS_DIR = join(ROOT, "tls");
const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.SRAP_PROXY_PORT ?? 4143);
const UPSTREAM_HOST = process.env.SRAP_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.SRAP_UPSTREAM_PORT ?? 4139);

const STRIP_EXACT = new Set(["forwarded", "x-real-ip", "via"]);
const STRIP_PREFIX = ["x-forwarded-"];

function canonicalizeForwarding(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIP_EXACT.has(lower)) continue;
    if (STRIP_PREFIX.some((p) => lower.startsWith(p))) continue;
    out[lower] = value;
  }
  // Exactly one canonical trusted protocol value — the proxy observed TLS.
  out["x-forwarded-proto"] = "https";
  return out;
}

const tls = {
  cert: readFileSync(join(TLS_DIR, "proxy.crt")),
  key: readFileSync(join(TLS_DIR, "proxy.key")),
};

const server = createServer(tls, (req, res) => {
  const headers = canonicalizeForwarding(req.headers);
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;

  const upstream = httpRequest(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy upstream error: ${err.message}`);
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  const addr = server.address();
  console.log(
    JSON.stringify({
      role: "srap-accept-tls-proxy",
      listening: `${addr.address}:${addr.port}`,
      upstream: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
      strippedForwardingHeaders: true,
    }),
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
