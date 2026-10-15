import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, readFile } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const handlerUrl = new URL("../../src/interfaces/cli/commands/security/inspector-auth.js", import.meta.url).href;
const stateUrl = new URL("../../src/governance/security/platform/user-state-paths.js", import.meta.url).href;

describe("Inspector workspace enrollment", () => {
  for (const [label, args, expected] of [
    ["legacy omission", [], undefined],
    ["canonical deduplication", ["--workspace", "./project", "--workspace", "./project/../project", "--workspace", "./alias", "--workspace", "$absolute"], ["project"]],
    ["multiple workspaces", ["--workspace", "./project", "--workspace", "./other"], ["project", "other"]],
    ["missing value", ["--workspace"], "reject"],
    ["flag is not a value", ["--workspace", "--json"], "reject"],
    ["empty value", ["--workspace", ""], "reject"],
    ["nonexistent path", ["--workspace", "./absent"], "reject"],
    ["invalid second path", ["--workspace", "./project", "--workspace", "./absent"], "reject"],
  ] as const) {
    it(label, async () => {
      const dir = await mkdtemp(join(tmpdir(), "alix-enrollment-"));
      try {
        await mkdir(join(dir, "project"));
        await mkdir(join(dir, "other"));
        await symlink(join(dir, "project"), join(dir, "alias"), process.platform === "win32" ? "junction" : "dir");
        const input = ["--name", "test", "--role", "operator", "--json", ...args.map(x => x === "$absolute" ? join(dir, "project") : x)];
        const script = `import {setStateDirOverride,getUserStatePaths} from ${JSON.stringify(stateUrl)};
          setStateDirOverride(${JSON.stringify(join(dir, "state"))});
          console.error('STATE:' + getUserStatePaths().authStateDir);
          const {handleInspectorAuthCreate} = await import(${JSON.stringify(handlerUrl)});
          await handleInspectorAuthCreate(${JSON.stringify(input)});`;
        const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
        assert.ifError(child.error);
        const stateDir = child.stderr.match(/STATE:(.*)/)?.[1];
        assert.ok(stateDir);
        const storePath = join(stateDir, "auth-store.json");
        if (expected === "reject") {
          assert.equal(child.status, 1);
          assert.equal(existsSync(storePath), false, "invalid enrollment must create no credential");
          assert.equal(existsSync(join(stateDir, "audit.jsonl")), false, "validation precedes auth-service mutation");
        } else {
          assert.equal(child.status, 0, child.stderr);
          const stored = JSON.parse(await readFile(storePath, "utf8"));
          assert.equal(stored.tokens.length, 1);
          assert.deepEqual(stored.tokens[0].workspaceIds, expected?.map(x => realpathSync.native(join(dir, x))));
        }
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});
