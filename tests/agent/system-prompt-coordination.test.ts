import assert from "node:assert/strict";
import { test } from "node:test";
import { SYSTEM_PROMPT_BASE } from "../../src/agent/system-prompt.js";

test("explicit multi-agent requests are routed through coordination", () => {
  assert.match(SYSTEM_PROMPT_BASE, /MUST call alix_coordination_run/);
  assert.match(SYSTEM_PROMPT_BASE, /Do not satisfy that request with ordinary tool calls/);
  assert.match(SYSTEM_PROMPT_BASE, /run id and worker outcomes/);
});
