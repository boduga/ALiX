/**
 * P4.3-Sc1.5 — HTTP Parser and Server Bounds
 *
 * Configures and enforces HTTP-level limits on the Inspector server to
 * prevent resource exhaustion and slow-header attacks.
 *
 * Limits applied:
 * - Maximum header size (prevents header-bloat DoS)
 * - Headers timeout (prevents slow-header/slowloris attacks)
 * - Request timeout (bounds total request processing time)
 * - Keep-alive timeout (bounds idle connection lifetime)
 * - Maximum requests per socket (prevents connection hoarding)
 * - Maximum URL length (prevents URL-based attacks)
 * - Rejection of GET/HEAD/DELETE request bodies
 * - Auth route body size limit
 *
 * @module
 */

import type { IncomingMessage } from "node:http";
import type { ServerOptions } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpLimitsConfig {
  /** Maximum total size of all request headers in bytes (default: 16384). */
  maxHeaderSize?: number;
  /** Maximum time to wait for complete headers in ms (default: 10000). */
  headersTimeout?: number;
  /** Maximum time for the entire request in ms (default: 30000). */
  requestTimeout?: number;
  /** Maximum idle time for keep-alive connections in ms (default: 5000). */
  keepAliveTimeout?: number;
  /** Maximum number of requests per keep-alive connection (default: 100). */
  maxRequestsPerSocket?: number;
  /** Maximum URL length in bytes (default: 8192). */
  maxUrlLength?: number;
}

export interface HttpLimitValidationResult {
  /** Whether the request passed all limits. */
  ok: boolean;
  /** Stable error code if rejected. */
  error?: string;
  /** HTTP status code if rejected. */
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_HEADER_SIZE = 16 * 1024; // 16 KB
export const DEFAULT_HEADERS_TIMEOUT = 10_000; // 10 seconds
export const DEFAULT_REQUEST_TIMEOUT = 30_000; // 30 seconds
export const DEFAULT_KEEP_ALIVE_TIMEOUT = 5_000; // 5 seconds
export const DEFAULT_MAX_REQUESTS_PER_SOCKET = 100;
export const DEFAULT_MAX_URL_LENGTH = 8 * 1024; // 8 KB
export const DEFAULT_AUTH_BODY_LIMIT = 10 * 1024; // 10 KB

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

/**
 * Build Node.js `http.createServer` options from HttpLimitsConfig.
 *
 * Applies limits at the HTTP parser level where possible.
 * Some limits (URL length, GET body) are enforced in middleware.
 */
export function buildServerOptions(config?: HttpLimitsConfig): ServerOptions {
  const opts: Record<string, unknown> = {
    maxHeaderSize: config?.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE,
    headersTimeout: config?.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT,
    requestTimeout: config?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
    keepAliveTimeout: config?.keepAliveTimeout ?? DEFAULT_KEEP_ALIVE_TIMEOUT,
    maxRequestsPerSocket: config?.maxRequestsPerSocket ?? DEFAULT_MAX_REQUESTS_PER_SOCKET,
  };
  return opts as unknown as ServerOptions;
}

// ---------------------------------------------------------------------------
// Request-level validators (run in middleware)
// ---------------------------------------------------------------------------

/**
 * Validate URL length against the configured maximum.
 *
 * Must be called before URL parsing in the middleware.
 */
export function validateUrlLength(
  url: string | undefined,
  maxLength: number = DEFAULT_MAX_URL_LENGTH,
): HttpLimitValidationResult {
  if (!url) {
    return { ok: false, error: "invalid_url", statusCode: 400 };
  }

  if (Buffer.byteLength(url, "utf8") > maxLength) {
    return { ok: false, error: "url_too_long", statusCode: 414 };
  }

  return { ok: true };
}

/**
 * Check that request methods without bodies (GET, HEAD, DELETE, OPTIONS)
 * do not carry a Content-Length or Transfer-Encoding header.
 *
 * Some HTTP stacks ignore bodies on GET — we reject them explicitly.
 */
export function validateNoBodyOnReadMethods(
  req: IncomingMessage,
): HttpLimitValidationResult {
  const method = (req.method ?? "GET").toUpperCase();

  // Methods that may carry a body
  const bodyMethods = new Set(["POST", "PUT", "PATCH"]);

  if (bodyMethods.has(method)) {
    return { ok: true };
  }

  // For GET, HEAD, DELETE, OPTIONS, TRACE — reject if body is indicated
  const contentLength = getSingleHeader(req, "content-length");
  const transferEncoding = getSingleHeader(req, "transfer-encoding");

  if (contentLength !== undefined) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > 0) {
      return { ok: false, error: "body_not_allowed", statusCode: 400 };
    }
  }

  if (transferEncoding !== undefined) {
    return { ok: false, error: "body_not_allowed", statusCode: 400 };
  }

  return { ok: true };
}

/**
 * Validate that the auth request body does not exceed the configured limit.
 *
 * Auth routes (session exchange, logout) have a strict body size limit
 * to prevent DoS attacks on authentication endpoints.
 */
export function validateAuthBodySize(
  contentLength: string | undefined,
  maxBytes: number = DEFAULT_AUTH_BODY_LIMIT,
): HttpLimitValidationResult {
  if (!contentLength) {
    return { ok: true };
  }

  const len = parseInt(contentLength, 10);
  if (isNaN(len)) {
    return { ok: false, error: "invalid_content_length", statusCode: 400 };
  }

  if (len < 0) {
    return { ok: false, error: "invalid_content_length", statusCode: 400 };
  }

  if (len > maxBytes) {
    return { ok: false, error: "body_too_large", statusCode: 413 };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slow-header detection (middleware helper)
// ---------------------------------------------------------------------------

/**
 * Check whether the request has completed sending headers.
 *
 * If the headers are not yet complete after the configured timeout,
 * Node.js will emit a timeout event. This function provides a
 * middleware-level check for diagnostic purposes.
 *
 * Returns true when headers appear to be fully received (we have a method and url).
 */
export function headersReceived(req: IncomingMessage): boolean {
  return req.method !== undefined && req.url !== undefined;
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

/**
 * Compute elapsed time in milliseconds since the request started.
 * Uses SecurityContext.startTime (monotonic) when available,
 * otherwise falls back to Date.now().
 */
export function elapsedMs(startTime: number): number {
  return performance.now() - startTime;
}

// ---------------------------------------------------------------------------
// Combined validation (single call from middleware)
// ---------------------------------------------------------------------------

/**
 * Run all HTTP limit validations for an incoming request.
 *
 * Called early in the middleware pipeline, before route lookup.
 */
export function validateHttpLimits(
  req: IncomingMessage,
  config?: HttpLimitsConfig,
): HttpLimitValidationResult {
  // 1. URL length
  const urlResult = validateUrlLength(req.url, config?.maxUrlLength);
  if (!urlResult.ok) return urlResult;

  // 2. GET/HEAD/DELETE body check
  const bodyResult = validateNoBodyOnReadMethods(req);
  if (!bodyResult.ok) return bodyResult;

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSingleHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}
