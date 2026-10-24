/**
 * subagent-usage-emission.vitest.ts — pins that a subagent records its tokens.
 *
 * The bug: `subagent-cli.ts` called `provider.complete(...)` and consumed only
 * `resp.text` / `resp.toolCalls`. It never read `resp.usage` and never appended a
 * `model.usage` event, so every subagent turn — production coordination workers
 * included — spent tokens that were absent from the event log.
 *
 * That is a silent undercount, not a wrong number: delegated work simply did not
 * appear in any cost figure. Verified against real gpt-4o before the fix: ten
 * events, zero `model.usage`.
 *
 * This is a source-contract test. Driving a real provider here would need network
 * and credentials, so the test asserts the emission exists at the provider-call
 * boundary and mirrors the main loop's honest `runId` posture.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cliSrc = readFileSync(join(repoRoot, "src", "agents", "subagent-cli.ts"), "utf-8");
const mainSrc = readFileSync(
  join(repoRoot, "src", "execution", "run", "task-loop", "main.ts"),
  "utf-8",
);

describe("subagent model.usage emission", () => {
  it("appends a model.usage event at all", () => {
    // The whole finding: this string was absent from subagent-cli.ts.
    expect(cliSrc).toContain('type: "model.usage"');
  });

  it("emits immediately after the provider call returns", () => {
    const call = cliSrc.indexOf("await provider.complete({");
    const emit = cliSrc.indexOf('type: "model.usage"');
    expect(call).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(-1);
    // The emission must follow the call, and precede the tool-call handling that
    // can `break` out of the loop — otherwise a final iteration records nothing.
    const firstToolHandling = cliSrc.indexOf("const toolCalls: ToolCall[] = resp.toolCalls");
    expect(emit).toBeGreaterThan(call);
    expect(emit).toBeLessThan(firstToolHandling);
  });

  it("only emits when the provider actually reported usage", () => {
    // A provider that returns no usage must not produce a zero-token event.
    expect(cliSrc).toMatch(/if \(resp\.usage\)/);
  });

  it("uses the shared payload builder so the shape cannot drift from the main loop", () => {
    expect(cliSrc).toContain("buildModelUsageEventPayload");
    expect(mainSrc).toContain("buildModelUsageEventPayload");
  });

  it("does not fabricate a runId the child does not have", () => {
    // The child has no authoritative caller run identity. The main loop omits the
    // field rather than guessing; the child must do the same.
    const emitBlock = cliSrc.slice(
      cliSrc.indexOf('type: "model.usage"') - 400,
      cliSrc.indexOf('type: "model.usage"') + 200,
    );
    expect(emitBlock).not.toMatch(/runId:\s*["'`]/);
    expect(emitBlock).not.toContain("runId: randomUUID");
  });

  it("never lets usage telemetry fail the worker", () => {
    // Work is already done when usage is appended; a telemetry failure must not
    // convert a successful subagent into a failed one.
    const emitIdx = cliSrc.indexOf('type: "model.usage"');
    const before = cliSrc.slice(Math.max(0, emitIdx - 300), emitIdx);
    expect(before).toMatch(/try\s*\{/);
  });
});
