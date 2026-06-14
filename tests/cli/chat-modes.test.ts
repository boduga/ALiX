import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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
});
