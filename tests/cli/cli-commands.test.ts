import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const cliPath = join(repoRoot, "dist", "src", "cli.js");

// --- §9.2: legacy commands are unknown; canonical commands are recognized ---

test("config set-default-model is an unknown command", () => {
  try {
    execFileSync(process.execPath, [cliPath, "config", "set-default-model"], { encoding: "utf8" });
    assert.fail("expected non-zero exit for removed command");
  } catch (err: any) {
    assert.notEqual(err.status, 0, "removed command must exit non-zero");
    assert.match(err.stderr ?? "", /Unknown command/, "stderr should report unknown command");
  }
});

test("config set-tier is an unknown command", () => {
  try {
    execFileSync(process.execPath, [cliPath, "config", "set-tier"], { encoding: "utf8" });
    assert.fail("expected non-zero exit for removed command");
  } catch (err: any) {
    assert.notEqual(err.status, 0, "removed command must exit non-zero");
    assert.match(err.stderr ?? "", /Unknown command/, "stderr should report unknown command");
  }
});

// The canonical commands are recognized: with stdin closed (EOF) they print
// their interactive menu, never falling through to "Unknown command". (The
// interactive selectors exit non-zero on EOF — an unsettled-await readline
// quirk — so the assertions inspect the captured stdout of the thrown error.)

function capturedOutput(err: any): string {
  return `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
}

test("models set-default is a recognized command (shows provider menu)", () => {
  try {
    execFileSync(process.execPath, [cliPath, "models", "set-default"], {
      encoding: "utf8",
      input: "",
    });
    assert.fail("interactive command should not exit cleanly on EOF");
  } catch (err: any) {
    const out = capturedOutput(err);
    assert.match(out, /Select a provider/, "should start the interactive selection");
    assert.doesNotMatch(out, /Unknown command/);
  }
});

test("models set-tier is a recognized command (shows tier menu)", () => {
  try {
    execFileSync(process.execPath, [cliPath, "models", "set-tier"], {
      encoding: "utf8",
      input: "",
    });
    assert.fail("interactive command should not exit cleanly on EOF");
  } catch (err: any) {
    const out = capturedOutput(err);
    assert.match(out, /thinking/, "should show the canonical tier menu");
    assert.doesNotMatch(out, /Unknown command/);
  }
});
