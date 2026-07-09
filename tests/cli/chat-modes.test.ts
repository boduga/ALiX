import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { buildChatSystemPrompt, executeWorkspaceTool, formatChatToolFailureMessage, isChatToolFailure, resolveChatMode, selectChatToolExecutor } from "../../src/cli/commands/chat.js";

describe("workspace chat tools", () => {
  it("uses provider-safe tool names", () => {
    const resolved = resolveChatMode({ workspace: true });
    for (const tool of resolved.tools) {
      assert.match(tool.name, /^[a-zA-Z0-9_-]+$/);
    }
  });

  it("surfaces web_search failure without stale fallback", () => {
    const result = "Error: BRAVE_API_KEY env var not set";
    assert.equal(isChatToolFailure(result), true);
    const message = formatChatToolFailureMessage("web_search", result);
    assert.ok(message.includes("web_search failed"));
    assert.ok(message.includes("BRAVE_API_KEY"));
    assert.ok(message.includes("cannot verify current information"));
  });

  it("routes web tools to chat executor in workspace mode", () => {
    assert.equal(selectChatToolExecutor("workspace", "web_search"), "chat");
    assert.equal(selectChatToolExecutor("workspace", "web_fetch"), "chat");
    assert.equal(selectChatToolExecutor("workspace", "file_read"), "workspace");
    assert.equal(selectChatToolExecutor("workspace", "dir_list"), "workspace");
    assert.equal(selectChatToolExecutor("workspace", "dir_search"), "workspace");
    assert.equal(selectChatToolExecutor("workspace", "workspace_pwd"), "workspace");
  });

  it("supports pwd and directory listing tools", async () => {
    const pwd = await executeWorkspaceTool("workspace_pwd", {});
    assert.equal(pwd, process.cwd());

    const listing = await executeWorkspaceTool("dir_list", { path: "." });
    assert.ok(listing.includes("package.json"), listing);
  });

  it("includes model identity in chat prompt", () => {
    const prompt = buildChatSystemPrompt(true, "google/gemini-2.5-pro");
    assert.ok(prompt.includes("google/gemini-2.5-pro"));
    assert.ok(prompt.includes("which model"));
  });
});

describe("parseChatArgs (via CLI)", () => {
  const cli = join(process.cwd(), "dist", "src", "cli.js");

  it("rejects unknown flag --foo", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--foo"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("Unknown option"), `Should reject, got: ${out}`);
    }
  });

  it("accepts --workspace and shows mode", () => {
    const out = execFileSync(process.execPath, [cli, "chat", "--workspace"], {
      encoding: "utf-8", timeout: 10000, input: "/exit\n",
    });
    assert.ok(out.includes("Mode:"), `Should show mode, got: ${out.slice(0, 200)}`);
  });

  it("accepts --agent and shows agent mode", () => {
    let out = "";
    try {
      out = execFileSync(process.execPath, [cli, "chat", "--agent"], {
        encoding: "utf-8", timeout: 10000, input: "/exit\n",
      });
    } catch (e: any) {
      out = e.stdout?.toString() || "";
    }
    assert.ok(out.includes("agent task console"), `Should show agent mode, got: ${out.slice(0, 200)}`);
  });

  it("rejects --list --agent conflict", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--list", "--agent"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("cannot be combined"), `Should reject combo, got: ${out}`);
    }
  });

  it("rejects --delete without value", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--delete"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("requires a session") || out.includes("Unknown option"), `Should require value, got: ${out}`);
    }
  });

  it("conversational mode suggests --workspace", () => {
    const out = execFileSync(process.execPath, [cli, "chat"], {
      encoding: "utf-8", timeout: 10000, input: "/exit\n",
    });
    assert.ok(out.includes("--workspace"), `Should suggest workspace flag, got: ${out.slice(0, 300)}`);
  });

  it("rejects --workspace --agent conflict", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--workspace", "--agent"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("cannot be combined"), `Should reject combo, got: ${out}`);
    }
  });
});
