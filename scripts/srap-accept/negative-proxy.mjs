#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — negative-test proxy (denial exercise only).
 *
 * Loopback-only, time-limited, and NEVER bound to the production proxy port
 * (4143). It intentionally forwards a MALFORMED `X-Forwarded-Proto` value so the
 * Inspector's trusted-proxy handling can be observed to deny it. It is not a
 * production proxy configuration and proves nothing about untrusted peers.
 *
 * This is inert fixture infrastructure: no product logic, never imported by
 * `src/**`.
 *
 * Env:
 *   SRAP_NEG_PROXY_PORT    listen port (default 4144; must not be 4143)
 *   SRAP_UPSTREAM_HOST     upstream host (default 127.0.0.1)
 *   SRAP_UPSTREAM_PORT     upstream port (default 4139)
 *   SRAP_MALFORMED_XFP     value written to X-Forwarded-Proto (default "https,http")
 *   SRAP_NEG_TTL_SECONDS   auto-shutdown after N seconds (default 60)
 */
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.SRAP_NEG_PROXY_PORT ?? 4144);
const UPSTREAM_HOST = process.env.SRAP_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.SRAP_UPSTREAM_PORT ?? 4139);
const MALFORMED_XFP = process.env.SRAP_MALFORMED_XFP ?? "https,http";
const TTL_SECONDS = Number(process.env.SRAP_NEG_TTL_SECONDS ?? 60);

if (LISTEN_PORT === 4143) {
  console.error("negative proxy must not bind the production proxy port 4143");
  process.exit(1);
}

const STRIP_EXACT = new Set(["forwarded", "x-real-ip", "via"]);
const STRIP_PREFIX = ["x-forwarded-"];

function malform(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIP_EXACT.has(lower)) continue;
    if (STRIP_PREFIX.some((p) => lower.startsWith(p))) continue;
    out[lower] = value;
  }
  out["x-forwarded-proto"] = MALFORMED_XFP;
  return out;
}

const server = createServer((req, res) => {
  const headers = malform(req.headers);
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
    res.end(`negative-proxy upstream error: ${err.message}`);
  });
  req.pipe(upstream);
});

const timer = setTimeout(() => {
  console.log(JSON.stringify({ role: "srap-accept-negative-proxy", event: "ttl-expired", ttlSeconds: TTL_SECONDS }));
  server.close(() => process.exit(0));
}, TTL_SECONDS * 1000);
timer.unref();

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  const addr = server.address();
  console.log(
    JSON.stringify({
      role: "srap-accept-negative-proxy",
      listening: `${addr.address}:${addr.port}`,
      upstream: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
      malformedXForwardedProto: MALFORMED_XFP,
      ttlSeconds: TTL_SECONDS,
    }),
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
