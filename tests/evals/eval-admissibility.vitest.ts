import { describe, expect, it } from "vitest";
import { classifyInadmissible } from "../../src/operations/evals/eval-admissibility.js";

/**
 * PARITY TABLE for admissibility classification.
 *
 * The repo rule is that any change to what an allow/deny decision AUTHORIZES
 * needs explicit expected outcomes in a table broader than the implementation,
 * because a spot check on the new cases says nothing about what stopped working.
 *
 * Two directions matter, and they fail differently:
 *   - Missed inadmissible (should be excluded, scored instead) → a provider
 *     fault silently becomes a result. This is the bug that motivated the table.
 *   - Over-broad inadmissible (a real failure excluded) → model misbehaviour is
 *     hidden, and a failing agent looks merely unlucky.
 *
 * So the table pins BOTH: every provider-fault shape, AND ordinary agent
 * outcomes that must stay scoreable.
 */
describe("classifyInadmissible — parity", () => {
  describe("provider faults are excluded", () => {
    it.each([
      ["API error 429: quota exceeded", "provider-quota"],
      ["quota exceeded", "provider-quota"],
      ["Insufficient quota for this request", "provider-quota"],
      ["402 payment required", "provider-quota"],
      ["insufficient credit balance", "provider-quota"],
      ["Channel rate limit reached for model", "provider-rate-limit"],
      ["max retries exceeded: too many requests", "provider-rate-limit"],
      ["API error 429: rate limit", "provider-rate-limit"],
      ["API error 401: invalid API key", "provider-auth"],
      ["unauthorized", "provider-auth"],
      ["API error 403: forbidden", "provider-auth"],
      ["Bad Gateway", "provider-server"],
      ["API error 502", "provider-server"],
      ["Internal Server Error", "provider-server"],
      ["Service Unavailable", "provider-server"],
      ["request timed out after 300s", "timeout"],
      ["AbortError: aborted", "timeout"],
      ["ETIMEDOUT", "timeout"],
      ["ECONNREFUSED 127.0.0.1:11434", "transport"],
      ["fetch failed", "transport"],
      ["socket hang up", "transport"],
      ["getaddrinfo ENOTFOUND api.example.com", "transport"],
    ])("%s → %s", (message, reason) => {
      const verdict = classifyInadmissible(message);
      expect(verdict.admissible).toBe(false);
      if (!verdict.admissible) {
        expect(verdict.reason).toBe(reason);
        // The original text is retained verbatim for the evidence record.
        expect(verdict.detail).toBe(message);
      }
    });
  });

  describe("specificity order", () => {
    it("calls an explicit quota message quota, not merely rate-limited", () => {
      // "API error 429: quota exceeded" matches both signatures. The more
      // specific classification is the more useful one.
      const verdict = classifyInadmissible("API error 429: quota exceeded");
      expect(verdict.admissible).toBe(false);
      if (!verdict.admissible) expect(verdict.reason).toBe("provider-quota");
    });
  });

  describe("agent outcomes stay scoreable", () => {
    it.each([
      [undefined],
      [""],
      ["   "],
      // Ordinary task failures. Treating these as inadmissible would hide the
      // very behaviour the deny/partial cases exist to measure.
      ["Subagent failed"],
      ["No write attempts against owned paths: docs/a.txt"],
      ["All 2 subagent tool call(s) failed (shell.run: 1, file.create: 1)"],
      ["Non-retryable write failures: ../outside/report.md"],
      ["delegated objective incomplete"],
      ["Shell access denied: command references sensitive path (.alix/.ssh/.git/.env)"],
      ["Command exited with code 2: ls -la"],
      ["Objective not met: file missing: report.md"],
    ])("%s stays admissible", (message) => {
      expect(classifyInadmissible(message).admissible).toBe(true);
    });
  });

  it("does not treat an unknown message as inadmissible", () => {
    // Fail toward visibility: an unrecognised failure is scored as an agent
    // outcome, so a new failure mode is never silently discarded.
    expect(classifyInadmissible("something entirely new happened").admissible).toBe(true);
  });
});
