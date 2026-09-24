import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TUI_SLASH_COMMANDS,
  CLI_COMMANDS,
  renderSelfCapabilitySection,
} from "../../src/agent/self-capabilities.js";
import { parseWorkbenchBuiltinCommand } from "../../src/tui/workbench/input/builtin-command.js";
import { setupSystemPrompt } from "../../src/agent/session/setup.js";

describe("self capabilities", () => {
  it("renders every CLI and TUI command", () => {
    const text = renderSelfCapabilitySection();
    assert.match(text, /## Your Capabilities/);
    for (const entry of CLI_COMMANDS) {
      assert.ok(text.includes(entry.name), `missing CLI entry: ${entry.name}`);
    }
    for (const entry of TUI_SLASH_COMMANDS) {
      assert.ok(text.includes(entry.name), `missing TUI entry: ${entry.name}`);
    }
  });

  it("anchors the claim-verification tool so models can find it", () => {
    const text = renderSelfCapabilitySection();
    assert.match(text, /alix_verify_claim/);
    assert.match(text, /do not web-search or web-fetch/);
  });

  it("lists skill slash names when provided", () => {
    const text = renderSelfCapabilitySection({ skills: ["/tdd", "/diagnose"] });
    assert.match(text, /Skill slash commands/);
    assert.ok(text.includes("/tdd"));
    assert.ok(text.includes("/diagnose"));
  });

  it("keeps TUI_SLASH_COMMANDS in sync with the workbench parser", () => {
    for (const entry of TUI_SLASH_COMMANDS) {
      assert.notEqual(
        parseWorkbenchBuiltinCommand(entry.name),
        null,
        `${entry.name} is advertised but not handled by parseWorkbenchBuiltinCommand`,
      );
    }
  });

  it("is injected into the assembled system prompt", async () => {
    const prompt = await setupSystemPrompt(process.cwd(), { shellTask: false, matchedSkills: [] });
    assert.match(prompt, /## Your Capabilities/);
    assert.match(prompt, /alix coordination/);
    assert.match(prompt, /\/agents/);
    assert.match(prompt, /\/artifacts/);
  });
});
