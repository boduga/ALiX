import test from "node:test";
import assert from "node:assert/strict";
import { parseRunArgs, type RunArgs } from "../../src/cli/run-args.js";

// ---------- helper ----------

function assertArgs(
  label: string,
  rawArgs: string[],
  expected: Partial<RunArgs> & { task: string },
): void {
  test(label, () => {
    const result = parseRunArgs(rawArgs);
    assert.deepStrictEqual(result, {
      task: expected.task,
      noStream: expected.noStream ?? false,
      noPlan: expected.noPlan ?? false,
      sessionMode: expected.sessionMode,
      resumeSessionId: expected.resumeSessionId,
      planFilePath: expected.planFilePath,
      intent: expected.intent ?? false,
      propose: expected.propose ?? false,
    });
  });
}

// ---------- 1. Bare task with no flags ----------

assertArgs("bare task string", ["write a sorting algorithm"], {
  task: "write a sorting algorithm",
});

assertArgs("bare task with multiple words", ["refactor", "the", "auth", "module"], {
  task: "refactor the auth module",
});

assertArgs("bare task with punctuation", ["fix", "the", "parser's", "crash"], {
  task: "fix the parser's crash",
});

// ---------- 2. --no-stream boolean flag ----------

assertArgs("--no-stream boolean flag", ["--no-stream", "deploy to prod"], {
  task: "deploy to prod",
  noStream: true,
});

assertArgs("--no-stream at end (positional - treated as task text)", ["deploy", "--no-stream"], {
  task: "deploy --no-stream",
  noStream: false,
});

// ---------- 3. --mode=value format ----------

assertArgs("--mode=auto", ["--mode=auto", "run tests"], {
  task: "run tests",
  sessionMode: "auto",
});

assertArgs("--mode=ask", ["--mode=ask", "run tests"], {
  task: "run tests",
  sessionMode: "ask",
});

assertArgs("--mode=bypass", ["--mode=bypass", "run tests"], {
  task: "run tests",
  sessionMode: "bypass",
});

// ---------- 4. --session-mode value format ----------

assertArgs("--session-mode bypass", ["--session-mode", "bypass", "run tests"], {
  task: "run tests",
  sessionMode: "bypass",
});

assertArgs("--session-mode=auto", ["--session-mode=auto", "run tests"], {
  task: "run tests",
  sessionMode: "auto",
});

assertArgs("--session-mode ask", ["--session-mode", "ask", "run tests"], {
  task: "run tests",
  sessionMode: "ask",
});

// ---------- 5. Task text containing --no-stream literally ----------

assertArgs("task text containing --no-stream not stripped", [
  "add",
  "--no-stream",
  "support",
  "to",
  "the",
  "docs",
], {
  task: "add --no-stream support to the docs",
  noStream: false,
});

assertArgs("task text containing --no-stream after first non-flag", [
  "write",
  "`--no-stream`",
  "in",
  "the",
  "readme",
], {
  task: "write `--no-stream` in the readme",
  noStream: false,
});

// ---------- 6. Task text containing --session-mode literally ----------

assertArgs("task text containing --session-mode not stripped as flag", [
  "refer",
  "to",
  "--session-mode",
  "docs",
], {
  task: "refer to --session-mode docs",
  sessionMode: undefined,
});

assertArgs("--session-mode in task after non-flag token", [
  "explain",
  "--session-mode",
  "flag",
], {
  task: "explain --session-mode flag",
  sessionMode: undefined,
});

// ---------- 7. --resume <id> ----------

assertArgs("--resume <id>", ["--resume", "sess_abc123", "continue work"], {
  task: "continue work",
  resumeSessionId: "sess_abc123",
});

assertArgs("--resume=<id>", ["--resume=sess_abc123", "continue work"], {
  task: "continue work",
  resumeSessionId: "sess_abc123",
});

assertArgs("--resume with hyphenated id", ["--resume", "sess-xyz-789"], {
  task: "",
  resumeSessionId: "sess-xyz-789",
});

// ---------- 8. --plan-file <path> ----------

assertArgs("--plan-file <path>", ["--plan-file", "./plans/my-plan.md", "implement"], {
  task: "implement",
  planFilePath: "./plans/my-plan.md",
});

assertArgs("--plan-file=<path>", ["--plan-file=./plans/my-plan.md", "implement"], {
  task: "implement",
  planFilePath: "./plans/my-plan.md",
});

// ---------- 9. Multiple flags together ----------

assertArgs("--no-stream --no-plan together", [
  "--no-stream",
  "--no-plan",
  "build",
  "everything",
], {
  task: "build everything",
  noStream: true,
  noPlan: true,
});

assertArgs("--no-stream --mode=bypass together", [
  "--no-stream",
  "--mode=bypass",
  "deploy",
], {
  task: "deploy",
  noStream: true,
  sessionMode: "bypass",
});

assertArgs("--resume --no-stream together", [
  "--resume",
  "sess_001",
  "--no-stream",
  "finish",
  "up",
], {
  task: "finish up",
  noStream: true,
  resumeSessionId: "sess_001",
});

assertArgs("all flags together", [
  "--no-stream",
  "--no-plan",
  "--mode=ask",
  "--resume",
  "sess_99",
  "--plan-file",
  "plan.md",
  "do",
  "the",
  "thing",
], {
  task: "do the thing",
  noStream: true,
  noPlan: true,
  sessionMode: "ask",
  resumeSessionId: "sess_99",
  planFilePath: "plan.md",
});

// ---------- 9b. --intent and --propose boolean flags ----------

assertArgs("--intent flag", ["--intent", "run integration tests"], {
  task: "run integration tests",
  intent: true,
});

assertArgs("--propose flag (implies intent)", ["--propose", "run integration tests"], {
  task: "run integration tests",
  propose: true,
});

assertArgs("--intent --propose together", ["--intent", "--propose", "fix bug"], {
  task: "fix bug",
  intent: true,
  propose: true,
});

assertArgs("--propose --no-stream together", ["--propose", "--no-stream", "deploy"], {
  task: "deploy",
  propose: true,
  noStream: true,
});

// ---------- 10. Empty args ----------

test("empty args returns defaults", () => {
  const result = parseRunArgs([]);
  assert.deepStrictEqual(result, {
    task: "",
    noStream: false,
    noPlan: false,
    sessionMode: undefined,
    resumeSessionId: undefined,
    planFilePath: undefined,
    intent: false,
    propose: false,
  });
});

// ---------- 11. Unknown flags treated as task text ----------

assertArgs("unknown flag treated as task text", ["--unknown-flag", "do", "stuff"], {
  task: "--unknown-flag do stuff",
});

assertArgs("unknown flag with equals", ["--custom=value", "do", "stuff"], {
  task: "--custom=value do stuff",
});

// ---------- Edge cases ----------

assertArgs("task with only dashes", ["---", "weird"], {
  task: "--- weird",
});

assertArgs("flag with invalid mode value falls back to task text", [
  "--mode",
  "turbo",
  "run",
], {
  task: "--mode turbo run",
  sessionMode: undefined,
});

assertArgs("--session-mode with invalid value falls back to task text", [
  "--session-mode",
  "fast",
  "go",
], {
  task: "--session-mode fast go",
  sessionMode: undefined,
});

assertArgs("--mode=invalid value falls back to task text", ["--mode=invalid", "go"], {
  task: "--mode=invalid go",
  sessionMode: undefined,
});

assertArgs("--resume without value falls back to task text", ["--resume"], {
  task: "--resume",
  resumeSessionId: undefined,
});

assertArgs("--plan-file without value falls back to task text", ["--plan-file"], {
  task: "--plan-file",
  planFilePath: undefined,
});

assertArgs("no-stream flag appears in task but not as a leading flag", [
  "the",
  "option",
  "--no-stream",
  "is",
  "documented",
], {
  task: "the option --no-stream is documented",
  noStream: false,
});

assertArgs("mode flag buried in task is not consumed", [
  "please",
  "--mode=auto",
  "the",
  "system",
], {
  task: "please --mode=auto the system",
  sessionMode: undefined,
});

assertArgs("resume flag buried in task is not consumed", [
  "see",
  "--resume",
  "function",
], {
  task: "see --resume function",
  resumeSessionId: undefined,
});

assertArgs("missing value after --mode consumes nothing extra", ["--mode"], {
  task: "--mode",
  sessionMode: undefined,
});

assertArgs("positional: non-flag token after flag starts task region", [
  "--no-stream",
  "action",
  "--no-plan",
], {
  task: "action --no-plan",
  noStream: true,
  noPlan: false,
});
