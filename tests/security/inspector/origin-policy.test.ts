/**
 * origin-policy.test.ts — Sc1.2 Origin and Fetch Metadata validation tests.
 *
 * Covers:
 * - Same-origin requests
 * - Configured exact origins
 * - Wildcard origin with credentials
 * - No-Origin for Bearer clients
 * - Same-origin required for cookies
 * - Sec-Fetch-Site validation
 * - Null origin rejection
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateOrigin,
  validateSecFetchSite,
  validateRequestOrigin,
  type OriginPolicyContext,
} from "../../../src/security/inspector/origin-policy.js";

// ---------------------------------------------------------------------------
// Helpers — minimal IncomingMessage mock
// ---------------------------------------------------------------------------

function mockReq(headers: Record<string, string | string[] | undefined>): Parameters<typeof validateOrigin>[0] {
  return {
    headers,
    socket: {},
  } as unknown as Parameters<typeof validateOrigin>[0];
}

const NO_CREDENTIALS: OriginPolicyContext = {
  isBearerAuth: false,
  isCookieAuth: false,
  hasCredentials: false,
};

const BEARER_CTX: OriginPolicyContext = {
  isBearerAuth: true,
  isCookieAuth: false,
  hasCredentials: true,
};

const COOKIE_CTX: OriginPolicyContext = {
  isBearerAuth: false,
  isCookieAuth: true,
  hasCredentials: true,
};

// ---------------------------------------------------------------------------
// validateOrigin
// ---------------------------------------------------------------------------

describe("validateOrigin", () => {
  it("allows same-origin request", () => {
    const req = mockReq({
      origin: "http://127.0.0.1:4137",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], NO_CREDENTIALS);
    assert.ok(result.ok);
  });

  it("allows same-origin with localhost variants", () => {
    const req = mockReq({
      origin: "http://localhost:4137",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], NO_CREDENTIALS);
    assert.ok(result.ok);
  });

  it("allows configured exact origin", () => {
    const req = mockReq({
      origin: "https://app.example.com",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, ["https://app.example.com"], NO_CREDENTIALS);
    assert.ok(result.ok);
  });

  it("rejects disallowed origin", () => {
    const req = mockReq({
      origin: "https://evil.com",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], NO_CREDENTIALS);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.statusCode, 403);
      assert.equal(result.error, "origin_not_allowed");
    }
  });

  it("rejects wildcard origin with credentials", () => {
    const req = mockReq({
      origin: "https://evil.com",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, ["*"], BEARER_CTX);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "wildcard_origin_with_credentials");
    }
  });

  it("rejects null origin for credentialed requests", () => {
    const req = mockReq({
      origin: "null",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], BEARER_CTX);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "null_origin_denied");
    }
  });

  it("rejects null origin for cookie auth", () => {
    const req = mockReq({
      origin: "null",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], COOKIE_CTX);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "null_origin_denied");
    }
  });

  it("allows no-Origin for non-browser Bearer clients", () => {
    const req = mockReq({
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], BEARER_CTX);
    assert.ok(result.ok);
  });

  it("rejects cross-origin cookie auth", () => {
    const req = mockReq({
      origin: "https://evil.com",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], COOKIE_CTX);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "cross_origin_denied");
      assert.equal(result.statusCode, 403);
    }
  });

  it("returns vary headers on origin decision", () => {
    const req = mockReq({
      origin: "http://127.0.0.1:4137",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], NO_CREDENTIALS);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.varyHeaders?.includes("Origin"));
    }
  });

  it("rejects invalid Origin URL", () => {
    const req = mockReq({
      origin: "not-a-valid-origin",
      host: "127.0.0.1:4137",
    });
    const result = validateOrigin(req, [], NO_CREDENTIALS);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.statusCode, 400);
    }
  });
});

// ---------------------------------------------------------------------------
// validateSecFetchSite
// ---------------------------------------------------------------------------

describe("validateSecFetchSite", () => {
  it("allows when expected site matches", () => {
    const req = mockReq({
      "sec-fetch-site": "same-origin",
    });
    const result = validateSecFetchSite(req, "same-origin");
    assert.ok(result.ok);
  });

  it("rejects when expected site mismatches", () => {
    const req = mockReq({
      "sec-fetch-site": "cross-site",
    });
    const result = validateSecFetchSite(req, "same-origin");
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "sec_fetch_site_mismatch");
    }
  });

  it("allows when no Sec-Fetch-Site header (non-browser client)", () => {
    const req = mockReq({});
    const result = validateSecFetchSite(req, "same-origin");
    assert.ok(result.ok);
  });

  it("rejects invalid Sec-Fetch-Site value", () => {
    const req = mockReq({
      "sec-fetch-site": "invalid-value",
    });
    const result = validateSecFetchSite(req, "same-origin");
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "invalid_sec_fetch_site");
    }
  });

  it("skips when expected site is null", () => {
    const req = mockReq({
      "sec-fetch-site": "cross-site",
    });
    const result = validateSecFetchSite(req, null);
    assert.ok(result.ok);
  });
});

// ---------------------------------------------------------------------------
// validateRequestOrigin (combined)
// ---------------------------------------------------------------------------

describe("validateRequestOrigin", () => {
  it("allows same-origin with matching Sec-Fetch-Site", () => {
    const req = mockReq({
      origin: "http://127.0.0.1:4137",
      host: "127.0.0.1:4137",
      "sec-fetch-site": "same-origin",
    });
    const result = validateRequestOrigin(req, [], NO_CREDENTIALS, "same-origin");
    assert.ok(result.ok);
  });

  it("rejects when origin ok but Sec-Fetch-Site mismatches", () => {
    const req = mockReq({
      origin: "http://127.0.0.1:4137",
      host: "127.0.0.1:4137",
      "sec-fetch-site": "cross-site",
    });
    const result = validateRequestOrigin(req, [], NO_CREDENTIALS, "same-origin");
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "sec_fetch_site_mismatch");
    }
  });
});
