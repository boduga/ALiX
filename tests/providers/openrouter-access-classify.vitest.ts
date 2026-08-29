/**
 * openrouter-access-classify.vitest.ts — Unit tests for OpenRouter 403 access
 * classification. Guards the distinction between failure classes that ALiX's
 * fallback/governance must treat differently:
 *
 *   - model_access_restricted (harness-only free models) — NOT a payload issue
 *   - guardrail_blocked (content filter / prompt-injection)
 *   - account_rejection (backing provider not opted into) — self-healing
 *   - unknown
 */

import { describe, it, expect } from "vitest";
import {
  classifyProviderAccess,
  ProviderAccessError,
  type ProviderAccessClass,
} from "../../src/providers/openrouter-provider.js";
import { ApiError } from "../../src/providers/base.js";

const HARNESS_DETAIL =
  "thinkingmachines/inkling-small:free is only available on agentic harnesses. " +
  "Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps";

const GUARDRAIL_DETAIL = "Request blocked: prompt injection patterns detected";
const ACCOUNT_DETAIL = "No allowed providers are available for this model (allowed-providers)";

const cases: Array<{ status: number; detail: string; expected: ProviderAccessClass }> = [
  { status: 403, detail: HARNESS_DETAIL, expected: "model_access_restricted" },
  { status: 403, detail: "Only available for use with agentic harnesses.", expected: "model_access_restricted" },
  { status: 403, detail: GUARDRAIL_DETAIL, expected: "guardrail_blocked" },
  { status: 404, detail: ACCOUNT_DETAIL, expected: "account_rejection" },
  { status: 403, detail: ACCOUNT_DETAIL, expected: "account_rejection" },
  { status: 429, detail: "Rate limited", expected: "unknown" },
  { status: 503, detail: "Unavailable", expected: "unknown" },
  { status: 403, detail: "some other message", expected: "unknown" },
];

describe("classifyProviderAccess", () => {
  for (const c of cases) {
    it(`classifies ${c.detail.split(" ")[0]}… (${c.status}) as ${c.expected}`, () => {
      expect(classifyProviderAccess(c.status, c.detail)).toBe(c.expected);
    });
  }
});

describe("ProviderAccessError", () => {
  it("extends ApiError so existing instanceof checks still work", () => {
    const err = new ProviderAccessError(403, HARNESS_DETAIL, "model_access_restricted");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.detail).toBe(HARNESS_DETAIL);
    expect(err.accessClass).toBe("model_access_restricted");
    expect(String(err)).toContain("API error 403");
  });
});
