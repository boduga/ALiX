# Delegate Runtime Hardening — #565 + #566 + #567 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `delegate → worker` subagents land real edits in headless mode: accept unified-diff patches (#565), auto-approve writes scoped to owned paths (#566), and report `failed` honestly when writes don't land (#567).

**Architecture:** Three independent pre-existing defects in the delegate runtime, fixed in dependency order (#565 → #566 → #567). #565 wires the already-written but dead `PatchParser`/`StructuredPatchApplier` into the patch engine and adds a light aider-format normalizer. #566 threads `ownedPaths` from the subagent CLI through `ToolExecutor` → `ExecutionAuthorization` → `PolicyGate`, adding a path-scoped auto-approval rule ("ownership IS the authorization"). #567 tracks write-tool failures in the subagent loop and stops both the child and the manager from hardcoding success.

**Tech Stack:** TypeScript, `node:test` (`.test.ts` in `tests/` — run via `pnpm build && node --test dist/tests/...`, NOT vitest), child-process subagents, file-backed patch engine.

## Global Constraints

- Tests: `node:test` only. Run with `pnpm build && node --test dist/tests/<file>.js`. Vitest config only covers `tests/**/*.vitest.ts`.
- CLAUDE.md mandates GitNexus `impact` (upstream) BEFORE editing any symbol, and `detect_changes()` before committing. The index is stale (~105 commits behind `main`) — if `impact` returns degraded/empty results, fall back to grep for direct callers and report the blast radius manually.
- Memory `branch-workflow-policy`: no new work while other branches/PRs are open. Implement in a fresh worktree (`.claude/worktrees/`) — never on `main`.
- Pre-existing main CI failures (`supply-chain`, `unit`, `tui-smoke`, `graph-executor` "no enforcement" timeout, `fresh-install-onboarding`) reproduce on unmodified `main` — do not chase them.
- Do not add dependencies. Everything needed is already in `src/patch/` (dead code to be wired).
- The `#567` status rule is **failed-on-tool-failure only** (user-locked). A write-mode worker that attempts NO writes (concludes "no change needed") reports `success`. There is NO `partial` status and NO evidence-based success requirement in this PR.

---

### Task 1: Unified-diff execution in the patch engine (#565 core)

Wire the existing `PatchParser` + `StructuredPatchApplier` into `applyPatch`, add a `unified_diff` branch, and add an aider-format normalizer so `*** Begin Patch` text converts to unified diff.

**Files:**
- Modify: `src/patch/patch-parser.ts` (add `normalizeAiderFormat`, call it in `parse`)
- Modify: `src/patch/patch-engine.ts` (format gate ~72-74, parse branch ~76-81, `applyPatchBody` 190-256, `extractPatchFiles` 272-279, `extractPatchFilePaths` 281-289)
- Test: `tests/patch/patch-parser.test.ts`, `tests/patch-engine.test.ts`

**Interfaces:**
- Produces: `export function normalizeAiderFormat(patch: string): string` — converts aider `*** Begin Patch` / `*** Update File:` / `*** Add File:` / `*** Delete File:` framing to unified-diff headers; passthrough for non-aider input.
- Produces: `applyPatch(root, format, patchText, options)` now accepts `format === "unified_diff"` and returns `{ status: "applied", changedFiles, proposalId?, checkpointId? }`.

- [ ] **Step 1: Write failing tests for `normalizeAiderFormat`** in `tests/patch/patch-parser.test.ts` (add to the existing file, matching its `describe`/`test` style):

```ts
import { normalizeAiderFormat } from "../../src/patch/patch-parser.js";

test("normalizeAiderFormat converts *** Update File header to unified diff headers", () => {
  const input = [
    "*** Begin Patch",
    "*** Update File: src/foo.ts",
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  assert.equal(
    normalizeAiderFormat(input),
    "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,2 +1,2 @@\n-old\n+new"
  );
});

test("normalizeAiderFormat converts *** Add File / Delete File headers", () => {
  const add = normalizeAiderFormat("*** Add File: a.ts\n@@ -0,0 +1,1 @@\n+hi");
  assert.ok(add.startsWith("--- /dev/null\n+++ b/a.ts\n"));
  const del = normalizeAiderFormat("*** Delete File: b.ts\n@@ -1,1 +0,0 @@\n-gone");
  assert.ok(del.startsWith("--- a/b.ts\n+++ /dev/null\n"));
});

test("normalizeAiderFormat passes through non-aider text unchanged", () => {
  const plain = "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b";
  assert.equal(normalizeAiderFormat(plain), plain);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/patch/patch-parser.test.js`
Expected: FAIL with `normalizeAiderFormat is not a function`.

- [ ] **Step 3: Implement `normalizeAiderFormat`** in `src/patch/patch-parser.ts`:

```ts
const AIDER_FILE_RE = /^\*\*\* (Update File|Add File|Delete File): (.+)$/;

/** Convert aider-style "*** Begin Patch" / "*** Update File: P" framing to unified-diff headers. */
export function normalizeAiderFormat(patch: string): string {
  const lines = patch.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\*\*\* Begin Patch/.test(line) || /^\*\*\* End Patch/.test(line)) continue;
    const m = line.match(AIDER_FILE_RE);
    if (m) {
      const kind = m[1] as "Update File" | "Add File" | "Delete File";
      const path = m[2].trim();
      if (kind === "Add File") {
        out.push(`--- /dev/null`, `+++ b/${path}`);
      } else if (kind === "Delete File") {
        out.push(`--- a/${path}`, `+++ /dev/null`);
      } else {
        out.push(`--- a/${path}`, `+++ b/${path}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
```

In `PatchParser.parse`, normalize before the existing line loop:

```ts
parse(patch: string, _format: "unified" | "context" | "unified_minimal" = "unified"): ParsedPatch {
  let normalized = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/^\*\*\* Begin Patch/m.test(normalized)) {
    normalized = normalizeAiderFormat(normalized);
  }
  const lines = normalized.split("\n");
  // ... existing body unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/patch/patch-parser.test.js`
Expected: PASS (all existing + new).

- [ ] **Step 5: Write failing engine tests for `unified_diff`** in `tests/patch-engine.test.ts` (reuse the existing temp-dir fixture pattern already in the file):

```ts
test("applyPatch applies a unified diff (modify)", async () => {
  const dir = await makeTempDir();
  await writeFile(resolve(dir, "a.ts"), "const x = 1;\n");
  const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n";
  const result = await applyPatch(dir, "unified_diff", patch);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.changedFiles, ["a.ts"]);
  assert.equal(await readFile(resolve(dir, "a.ts"), "utf8"), "const x = 2;\n");
});

test("applyPatch creates and deletes files via unified diff /dev/null", async () => {
  const dir = await makeTempDir();
  await writeFile(resolve(dir, "old.ts"), "gone\n");
  const create = "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+fresh\n";
  assert.equal((await applyPatch(dir, "unified_diff", create)).status, "applied");
  assert.equal(await readFile(resolve(dir, "new.ts"), "utf8"), "fresh\n");
  const del = "--- a/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n";
  assert.equal((await applyPatch(dir, "unified_diff", del)).status, "applied");
  assert.equal(existsSync(resolve(dir, "old.ts")), false);
});

test("applyPatch rejects a conflicting unified diff", async () => {
  const dir = await makeTempDir();
  await writeFile(resolve(dir, "a.ts"), "const x = 1;\n");
  const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-const x = 999;\n+const x = 2;\n";
  await assert.rejects(() => applyPatch(dir, "unified_diff", patch), /conflict/i);
});

test("applyPatch normalizes aider *** Begin Patch text", async () => {
  const dir = await makeTempDir();
  await writeFile(resolve(dir, "a.ts"), "old\n");
  const patch = "*** Begin Patch\n*** Update File: a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n*** End Patch";
  const result = await applyPatch(dir, "unified_diff", patch);
  assert.equal(result.status, "applied");
  assert.equal(await readFile(resolve(dir, "a.ts"), "utf8"), "new\n");
});
```

`makeTempDir`/`readFile`/`writeFile`/`existsSync` — import per the existing fixture helpers already used in `tests/patch-engine.test.ts`.

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/patch-engine.test.js`
Expected: FAIL — `Unsupported edit format: unified_diff` (gate at line 72).

- [ ] **Step 7: Implement `unified_diff` in the engine**

`src/patch/patch-engine.ts`:

```ts
// line ~72: allow unified_diff
if (format !== "search_replace" && format !== "structured_patch" && format !== "unified_diff") {
  throw new Error(`Unsupported edit format: ${format}`);
}
```

Parse branch (~76-81):

```ts
if (format === "search_replace") {
  parsedBlocks = parseSearchReplace(patchText);
} else if (format === "structured_patch") {
  parsedBlocks = parseStructuredPatch(patchText);
} else {
  parsedBlocks = new PatchParser().parse(patchText);
}
```

Add a `unified_diff` branch in `applyPatchBody` (before the final `throw new Error(\`Unsupported edit format: ${format}\`)`):

```ts
if (format === "unified_diff") {
  const patch = patchData as ParsedPatch;
  if (patch.files.length === 0) throw new Error("No patch changes found");
  const ops: PatchOperation[] = patch.files.map((f) => ({
    path: f.newPath === "/dev/null" ? f.oldPath : f.newPath || f.oldPath,
    operation: f.newPath === "/dev/null" ? "delete" : f.oldPath === "/dev/null" ? "create" : "modify",
    content: undefined,
  }));
  const guard = validatePatchOperations(ops, DEFAULT_PATCH_GUARD_CONFIG);
  if (!guard.valid) throw new Error("Patch blocked by safety guard: " + guard.reason);

  const changedFiles: string[] = [];
  const parser = new PatchParser();
  const applier = new StructuredPatchApplier({ strict: true });
  for (const file of patch.files) {
    const targetPath = fpath(file);
    const absPath = resolvePatchPath(root, targetPath);
    const single: ParsedPatch = { files: [file], raw: "", normalized: false };
    const patchText = parser.serialize(single);
    if (file.newPath === "/dev/null") {
      const original = await readFile(absPath, "utf8");
      const applied = applier.apply(original, patchText);
      if (!applied.success) throw new Error(`Unified diff failed for ${targetPath}: ${applied.error ?? "unknown error"}`);
      await rm(absPath);
    } else {
      const original = file.oldPath === "/dev/null" ? "" : await readFile(absPath, "utf8");
      const applied = applier.apply(original, patchText);
      if (!applied.success) throw new Error(`Unified diff failed for ${targetPath}: ${applied.error ?? "unknown error"}`);
      if (file.oldPath === "/dev/null") await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, applied.content ?? "", "utf8");
    }
    changedFiles.push(targetPath);
  }
  return { status: "applied", changedFiles, proposalId, checkpointId };
}

function fpath(f: ParsedFile): string {
  return f.newPath === "/dev/null" ? f.oldPath : f.newPath || f.oldPath;
}
```

Update the two extract helpers to know `unified_diff`:

```ts
// extractPatchFiles(patchText, format): add before the trailing parseStructuredPatch call
if (format === "unified_diff") {
  const patch = new PatchParser().parse(patchText);
  return patch.files.map((f) => ({
    path: fpath(f),
    operation: f.newPath === "/dev/null" ? "delete" : f.oldPath === "/dev/null" ? "create" : "modify",
  }));
}

// extractPatchFilePaths(patchData, format): add a unified_diff branch using fpath()
```

Imports at top of `patch-engine.ts` — add: `PatchParser, type ParsedFile, type ParsedPatch` from `./patch-parser.js`; `StructuredPatchApplier` from `./structured-patch-applier.js`; `rm` to the existing `node:fs/promises` import.

- [ ] **Step 8: Run engine tests to verify they pass**

Run: `pnpm build && node --test dist/tests/patch-engine.test.js`
Expected: PASS — new unified-diff tests green; the pre-existing `buildEditFormatPolicy` tests (lines 198-231) still pass because Task 2 hasn't touched policy yet.

- [ ] **Step 9: Commit**

```bash
git add src/patch/patch-parser.ts src/patch/patch-engine.ts tests/patch/patch-parser.test.ts tests/patch-engine.test.ts
git commit -m "fix(patch): wire unified_diff execution + aider format normalization (#565)"
```

---

### Task 2: Surface `unified_diff` through policy, router, and tool schema (#565 surface)

Make `unified_diff` a declared, allowed format so explicit `format: "unified_diff"` calls pass the router gate, and tell the model it's acceptable.

**Files:**
- Modify: `src/patch/edit-format-policy.ts`
- Modify: `src/run/helpers.ts` (schema at 111-123)
- Test: `tests/patch-engine.test.ts` (assertions at 207, 215, 222, 226-231), `tests/patch-tools.test.ts`

**Interfaces:**
- Consumes: `applyPatch(..., "unified_diff", ...)` from Task 1.
- Produces: `buildEditFormatPolicy(...).allowed` now includes `"unified_diff"` (union with executable formats). `normalizePreferredFormat` may return `"unified_diff"`.

- [ ] **Step 1: Update the failing policy tests first** in `tests/patch-engine.test.ts`:

Replace the `allowed` assertions to include `"unified_diff"` and the final test to assert support:

```ts
// line 207, 215, 222: assert.deepEqual(policy.allowed, ["structured_patch", "search_replace", "unified_diff"])
// line 226-231:
test("buildEditFormatPolicy allows unified_diff once engine supports it", () => {
  const policy = buildEditFormatPolicy({ provider: "custom", preferred: "unified_diff" });
  assert.equal(policy.preferred, "unified_diff");
  assert.ok(policy.allowed.includes("unified_diff"));
});
```

Note: `policy.allowed` is built as `Array.from(new Set([preferred, alternate, ...EXECUTABLE_PATCH_FORMATS]))`, so the exact array order is `[preferred, alternate, unified_diff]` when unified_diff is the third union member. Use `assert.ok(policy.allowed.includes("unified_diff"))` plus `assert.deepEqual` against the exact expected array to match the actual order.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/patch-engine.test.js`
Expected: FAIL on the updated assertions (current `allowed` omits `unified_diff`).

- [ ] **Step 3: Implement** in `src/patch/edit-format-policy.ts`:

```ts
export type ExecutableFormat = Extract<EditFormat, "structured_patch" | "search_replace" | "unified_diff">;

const EXECUTABLE_PATCH_FORMATS: ExecutableFormat[] = [
  "structured_patch",
  "search_replace",
  "unified_diff",
];
```

Update `normalizePreferredFormat` return type to `ExecutableFormat` and its `includes` check to `EXECUTABLE_PATCH_FORMATS.includes(preferred as ExecutableFormat)`. Update `buildEditFormatPolicy`:

```ts
export function buildEditFormatPolicy(input: EditFormatPolicyInput): EditFormatPolicy {
  const defaultFormat = defaultEditFormatForProvider(input.provider);
  const requested = input.preferred ?? defaultFormat;
  const preferred = normalizePreferredFormat(input.provider, requested);
  const alternate = preferred === "search_replace" ? "structured_patch" : "search_replace";
  return {
    provider: input.provider,
    preferred,
    allowed: Array.from(new Set([preferred, alternate, ...EXECUTABLE_PATCH_FORMATS])),
    fullFileRewrite: "deny",
  };
}
```

`full_file` stays non-executable (never in the union) — full-file rewrites remain blocked, preserving the `fullFileRewrite: "deny"` contract.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/patch-engine.test.js`
Expected: PASS.

- [ ] **Step 5: Update the tool schema** in `src/run/helpers.ts` (lines 118-119):

```ts
format: { type: "string", description: "Patch format: 'search_replace', 'structured_patch', or 'unified_diff'. Unified diff is auto-detected; aider '*** Begin Patch' is normalized automatically." },
patchText: { type: "string", description: "The patch content. For search_replace, use:\n<<<<<<< SEARCH path=<file>\n<original>\n=======\n<replacement>\n>>>>>>> REPLACE\nFor unified_diff, use standard git diff: --- a/<file> / +++ b/<file> / @@ hunk headers." }
```

- [ ] **Step 6: Add an executor-level routing test** in `tests/patch-tools.test.ts` (follow the file's existing fixture pattern — build a `ToolExecutor`-or-composite router and call the `patch.apply` tool):

```ts
test("patch.apply accepts unified_diff through the executor", async () => {
  // Build the executor/router exactly as the file's existing cases do, then:
  const result = await executor.execute({
    toolCallId: "t1",
    name: "patch.apply",
    args: { format: "unified_diff", patchText: "--- a/target.ts\n+++ b/target.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n" },
  });
  assert.equal(result.kind, "success");
  // target.ts content is now "new"
});
```

Run it: `pnpm build && node --test dist/tests/patch-tools.test.js` — Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add src/patch/edit-format-policy.ts src/run/helpers.ts tests/patch-engine.test.ts tests/patch-tools.test.ts
git commit -m "fix(patch): allow unified_diff as a declared edit format + document it (#565)"
```

---

### Task 3: Owned-path auto-approval for headless write subagents (#566)

Thread `ownedPaths` from the subagent CLI into `PolicyGate` and add a path-scoped rule: a write tool (`file.create`/`file.delete`/`patch.apply`) whose mutation targets are all inside `ownedPaths` is auto-approved; targets outside are denied with a clear reason; unscoped writes (unparseable targets) fail closed. Explicit per-tool `deny` and protected-path rules still win (they run earlier).

**Files:**
- Modify: `src/runtime/execution-decision.ts` (`ExecutionDecisionRequest` + `ownedPaths?`)
- Modify: `src/runtime/execution-authorization.ts` (forward `ownedPaths` to `policyGate.evaluateToolCall`)
- Modify: `src/tools/executor.ts` (constructor param 10 `ownedPaths?`, forward into `execAuth.evaluate`)
- Modify: `src/policy/policy-gate.ts` (`ToolPolicyRequest.ownedPaths?` + new rule between step 5 and step 6)
- Modify: `src/agents/subagent-cli.ts` (pass `ownedPaths` to `ToolExecutor`)
- Test: `tests/policy/policy-gate.test.ts`, `tests/executor.test.ts`, `tests/runtime/execution-authorization.test.ts`

**Interfaces:**
- Consumes: `extractPatchPaths(format, patchText)` from `src/patch/patch-paths.ts`; `resolvePolicyPath(cwd, path)` already in `policy-gate.ts`.
- Produces: `ToolPolicyRequest.ownedPaths?: string[]`; `ExecutionDecisionRequest.ownedPaths?: string[]`; `ToolExecutor` 10th constructor arg `ownedPaths?: string[]`.
- Behavior: with `ownedPaths` set, `evaluateToolCall` returns `{ decision: "allow", matchedRuleId: "owned-path-rule" }` for owned writes and `{ decision: "deny", matchedRuleId: "owned-path-rule" }` for out-of-scope writes. Without `ownedPaths`, behavior is unchanged.

- [ ] **Step 1: Add the `ownedPaths` field to the request types**

`src/runtime/execution-decision.ts` — add `ownedPaths?: string[]` to `ExecutionDecisionRequest` (find the type, add the field with a one-line doc comment).

`src/policy/policy-gate.ts` — add `ownedPaths?: string[]` to `ToolPolicyRequest`.

- [ ] **Step 2: Write the failing PolicyGate tests** in `tests/policy/policy-gate.test.ts` (reuse the file's existing `PolicyGate` + config fixtures):

```ts
import { extractPatchPaths } from "../../src/patch/patch-paths.js";

const gateConfig = (tools: Record<string, string>) => ({
  permissions: { default: "ask", sessionMode: "ask", tools, protectedPaths: [".git", ".env"] },
});

test("owned-path rule auto-approves file.create on an owned path", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const decision = await gate.evaluateToolCall({
    requestId: "r1", toolName: "file.create", args: { path: "src/new.ts" }, cwd: "/ws",
    sessionMode: "ask", source: "tool", ownedPaths: ["src"],
  });
  assert.equal(decision.decision, "allow");
  assert.equal(decision.matchedRuleId, "owned-path-rule");
});

test("owned-path rule auto-approves patch.apply when its targets are owned (search_replace + unified_diff)", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const sr = await gate.evaluateToolCall({
    requestId: "r2", toolName: "patch.apply",
    args: { format: "search_replace", patchText: "<<<<<<< SEARCH path=src/a.ts\nold\n=======\nnew\n>>>>>>> REPLACE" },
    cwd: "/ws", sessionMode: "ask", source: "tool", ownedPaths: ["src"],
  });
  assert.equal(sr.decision, "allow");
  const ud = await gate.evaluateToolCall({
    requestId: "r3", toolName: "patch.apply",
    args: { format: "unified_diff", patchText: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n" },
    cwd: "/ws", sessionMode: "ask", source: "tool", ownedPaths: ["src"],
  });
  assert.equal(ud.decision, "allow");
});

test("owned-path rule denies a write outside owned paths with a clear reason", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const decision = await gate.evaluateToolCall({
    requestId: "r4", toolName: "file.create", args: { path: "config.json" }, cwd: "/ws",
    sessionMode: "ask", source: "tool", ownedPaths: ["src"],
  });
  assert.equal(decision.decision, "deny");
  assert.match(decision.reason, /outside owned paths/);
});

test("owned-path rule does NOT auto-approve shell.run even with ownedPaths", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const decision = await gate.evaluateToolCall({
    requestId: "r5", toolName: "shell.run", args: { command: "rm -rf src" }, cwd: "/ws",
    sessionMode: "ask", source: "tool", ownedPaths: ["src"],
  });
  assert.notEqual(decision.decision, "allow");
});

test("protected paths still deny even when owned", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const decision = await gate.evaluateToolCall({
    requestId: "r6", toolName: "file.create", args: { path: ".env" }, cwd: "/ws",
    sessionMode: "ask", source: "tool", ownedPaths: ["src", ".env"],
  });
  assert.equal(decision.decision, "deny");
});

test("owned-path rule is inert without ownedPaths (still asks / approval-store-missing)", async () => {
  const gate = new PolicyGate(gateConfig({}), { eventLog: undefined, approvalStore: undefined } as any);
  const decision = await gate.evaluateToolCall({
    requestId: "r7", toolName: "file.create", args: { path: "src/new.ts" }, cwd: "/ws",
    sessionMode: "ask", source: "tool",
  });
  assert.equal(decision.decision, "deny"); // approval-store-missing, unchanged behavior
});
```

Match the constructor/import style already present in the file (it may construct `new PolicyGate(config, deps)` with a real stub deps object — mirror it; do not copy the `as any` literal if the file has a cleaner fixture).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/policy/policy-gate.test.js`
Expected: FAIL — the rule does not exist yet (falls through to approval-store-missing deny on every case).

- [ ] **Step 4: Implement the owned-path rule in `PolicyGate.evaluateToolCall`**

`src/policy/policy-gate.ts`:

```ts
import { extractPatchPaths } from "../patch/patch-paths.js";

// module-level helpers
const OWNED_WRITE_TOOLS = new Set(["file.create", "file.delete", "patch.apply"]);

function mutationTargets(args: Record<string, unknown>): string[] {
  const path = typeof args.path === "string" ? args.path : undefined;
  if (path) return [path];
  const format = typeof args.format === "string" ? args.format : undefined;
  return extractPatchPaths(format, args.patchText);
}

function isWithinOwned(resolvedTarget: string, ownedPaths: string[], cwd: string): boolean {
  return ownedPaths.some((owned) => {
    const resolvedOwned = resolvePolicyPath(cwd, owned);
    return resolvedTarget === resolvedOwned || resolvedTarget.startsWith(resolvedOwned + "/");
  });
}
```

Insert as **step 5.5** in `evaluateToolCall`, between the `config.permissions.tools?.[capability]` block and the `config.permissions.default` block:

```ts
// 5.5 Owned-path auto-approval (headless write subagents).
// The subagent's ownedPaths ARE the authorization: a write scoped entirely to
// owned paths is allowed; a write touching anything outside them is denied.
if (request.ownedPaths?.length && OWNED_WRITE_TOOLS.has(request.toolName)) {
  const targets = mutationTargets(args);
  if (targets.length === 0) {
    // Unscoped (unparseable targets) — fall through to default/ask; headless
    // subagents have no approval store so this fails closed.
  } else if (targets.every((t) => isWithinOwned(resolvePolicyPath(request.cwd, t), request.ownedPaths!, request.cwd))) {
    return {
      requestId, capability, decision: "allow",
      reason: "Write targets owned path", matchedRuleId: "owned-path-rule", policyRevision,
    };
  } else {
    const outside = targets.filter((t) => !isWithinOwned(resolvePolicyPath(request.cwd, t), request.ownedPaths!, request.cwd));
    return {
      requestId, capability, decision: "deny",
      reason: `Write target outside owned paths: ${outside.join(", ")}`, matchedRuleId: "owned-path-rule", policyRevision,
    };
  }
}
```

Ordering guarantees: protected paths (step 1) and explicit per-tool deny (step 5) return `deny` before this rule runs; `sessionMode` bypass/auto (step 0) returns `allow` before it. `request.toolName` is present on the tool path (the only path that reaches this rule).

- [ ] **Step 5: Run PolicyGate tests to verify they pass**

Run: `pnpm build && node --test dist/tests/policy/policy-gate.test.js`
Expected: PASS.

- [ ] **Step 6: Thread `ownedPaths` through executor + execution-authorization**

`src/tools/executor.ts` — constructor (add param 10 after `ownershipRegistry`):

```ts
private ownedPaths?: string[],
```

In `execute()`, add to the `execAuth.evaluate({ ... })` call (193-203): `ownedPaths: this.ownedPaths,`.

`src/runtime/execution-authorization.ts` — in `evaluate()`, forward into `policyGate.evaluateToolCall`: add `ownedPaths: request.ownedPaths,` alongside the existing `args`/`cwd` fields.

- [ ] **Step 7: Pass `ownedPaths` from the subagent CLI**

`src/agents/subagent-cli.ts` (209-215):

```ts
const executor = new ToolExecutor(
  config,
  eventLog,
  projectRoot,
  mcpManager ?? undefined,
  buildEditFormatPolicy({ provider: effectiveProvider, preferred: provider.editFormatPreference }),
  undefined, // extraHandlers
  undefined, // checkpointManager
  undefined, // approvalStore
  undefined, // workspacePathResolver
  undefined, // ownershipRegistry
  mode === "write" ? ownedPaths : undefined,
);
```

- [ ] **Step 8: Add executor + authorization tests**

`tests/executor.test.ts` (follow the file's existing `ToolExecutor` fixture — DEFAULT_CONFIG with `ask` default):

```ts
test("executor auto-approves an owned-path write for a subagent with ownedPaths", async () => {
  const executor = new ToolExecutor(config, log, wsDir, undefined, editFormatPolicy, undefined, undefined, undefined, undefined, undefined, ["src"]);
  const result = await executor.execute({
    toolCallId: "t1", name: "file.create",
    args: { path: "src/new.ts", content: "// hi" },
  });
  assert.equal(result.kind, "success");
});

test("executor denies a write outside ownedPaths with the owned-path reason", async () => {
  const executor = new ToolExecutor(config, log, wsDir, undefined, editFormatPolicy, undefined, undefined, undefined, undefined, undefined, ["src"]);
  const result = await executor.execute({
    toolCallId: "t2", name: "file.create",
    args: { path: "config.json", content: "{}" },
  });
  assert.equal(result.kind, "denied");
  assert.match(result.reason, /outside owned paths/);
});
```

`tests/runtime/execution-authorization.test.ts` — add a case asserting `ownedPaths` is forwarded: stub `policyGate.evaluateToolCall`, call `authorization.evaluate({ ownedPaths: ["src"], ... })`, assert the stub received `ownedPaths: ["src"]`.

Run both: `pnpm build && node --test dist/tests/executor.test.js dist/tests/runtime/execution-authorization.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/execution-decision.ts src/runtime/execution-authorization.ts src/tools/executor.ts src/policy/policy-gate.ts src/agents/subagent-cli.ts tests/policy/policy-gate.test.ts tests/executor.test.ts tests/runtime/execution-authorization.test.ts
git commit -m "fix(delegate): auto-approve writes scoped to ownedPaths for headless subagents (#566)"
```

---

### Task 4: Honest subagent status in the worker loop (#567, layer 1)

Track write-tool failures in the subagent run loop and report `status: "failed"` (with non-zero exit) when any write tool failed. Fix the latent `Error: undefined` for denied results.

**Files:**
- Modify: `src/agents/subagent-cli.ts`
- Test: `tests/agents/subagent-cli.test.ts`

**Interfaces:**
- Produces: `export function computeSubagentStatus(fatalWriteFailures: string[]): "success" | "failed"` — `"failed"` iff the array is non-empty (user-locked rule: failed on tool failure; a no-write-attempted run is `success`).
- Produces: `export function subagentToolError(result: ExecuteResult): string` — the human error string for a non-success result (`denied` → `reason`; `error` → `message`), fixing `Error: undefined`.
- Consumes: `SubagentResult` from `../config/schema.js`; `ExecuteResult` from `../tools/executor.js` (or `./types.js`).

- [ ] **Step 1: Write the failing helper tests** in `tests/agents/subagent-cli.test.ts` (append to the existing file):

```ts
import { computeSubagentStatus, subagentToolError } from "../../src/agents/subagent-cli.js";

test("computeSubagentStatus: success when no write tool failed", () => {
  assert.equal(computeSubagentStatus([]), "success");
});

test("computeSubagentStatus: failed when a write tool failed (error)", () => {
  assert.equal(computeSubagentStatus(["patch.apply"]), "failed");
});

test("computeSubagentStatus: failed when a write tool was denied", () => {
  assert.equal(computeSubagentStatus(["file.create"]), "failed");
});

test("subagentToolError: uses reason for denied results", () => {
  assert.equal(subagentToolError({ kind: "denied", reason: "Path protected: /x" }), "Path protected: /x");
});

test("subagentToolError: uses message for error results", () => {
  assert.equal(subagentToolError({ kind: "error", message: "No patch changes found" }), "No patch changes found");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: FAIL — `computeSubagentStatus` / `subagentToolError` are not exported.

- [ ] **Step 3: Implement the helpers** in `src/agents/subagent-cli.ts`:

```ts
/** Executor-side names of mutation tools the worker may call. (file.write is a policy key, not a tool.) */
const WRITE_EXEC_NAMES = new Set(["file.create", "file.delete", "patch.apply"]);

export function computeSubagentStatus(fatalWriteFailures: string[]): "success" | "failed" {
  return fatalWriteFailures.length > 0 ? "failed" : "success";
}

export function subagentToolError(result: { kind: string; message?: string; reason?: string }): string {
  if (result.kind === "denied") return result.reason ?? "Tool call denied";
  return result.message ?? "Tool call failed";
}
```

- [ ] **Step 4: Wire failure tracking into the run loop**

In the loop body (around lines 288-312), replace the `resultContent` computation and add tracking:

```ts
const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

const fatalWriteFailures: string[] = []; // hoisted above the while loop
const resultContent =
  execResult.kind === "success"
    ? (execResult.output ?? (execResult as { content?: string }).content ?? "")
    : `Error: ${subagentToolError(execResult)}`;

if (execResult.kind !== "success" && WRITE_EXEC_NAMES.has(execName)) {
  if (!fatalWriteFailures.includes(execName)) fatalWriteFailures.push(execName);
}
if (execResult.kind === "success" && resultContent.trim()) {
  toolOutputs.push(resultContent);
}
```

(Keep `toolOutputs` and `text` as-is; only add the failure tracking and swap the `Error:` construction.)

- [ ] **Step 5: Honor the status at both exit-0 result sites**

Extract a small local builder and use it in both the `done`-tool site (~300-312) and the loop-exhausted site (~326-334):

```ts
function buildResult(
  taskId: string, role: SubagentRole, mode: "read_only" | "write",
  text: string, toolOutputs: string[], fatalWriteFailures: string[],
): SubagentResult {
  const status = computeSubagentStatus(fatalWriteFailures);
  return {
    id: taskId, role, status,
    findings: buildSubagentFindings(text || "Task completed.", toolOutputs),
    events: [],
    error: status === "failed"
      ? (fatalWriteFailures.length
          ? `Non-retryable write failures: ${fatalWriteFailures.join(", ")}`
          : "Subagent failed")
      : undefined,
  };
}
```

Replace both sites' hardcoded `status: "success" as const` with the builder, and change `process.exit(0)` → `process.exit(status === "success" ? 0 : 1)`. Because the failed JSON must still reach the manager's stdout parse, print the JSON via `console.log(formatSubagentResult(result, outputFormat))` in both sites regardless of status (the manager distinguishes by `status`/exit code, not by stream). For `outputFormat === "text"`, `formatSubagentResult` already returns the error string for non-success — keep it on stdout.

Also add prompt hardening to the `Critical Rules` block (~231-246): `- NEVER emit aider '*** Begin Patch' format. Use only 'search_replace', 'structured_patch', or 'unified_diff'.`

- [ ] **Step 6: Run subagent-cli tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: PASS (helpers + existing).

- [ ] **Step 7: Commit**

```bash
git add src/agents/subagent-cli.ts tests/agents/subagent-cli.test.ts
git commit -m "fix(delegate): report failed status when a worker's writes fail (#567)"
```

---

### Task 5: Manager honors the child's parsed status (#567, layer 2)

Stop `SubagentManager` from overwriting an honest failed result with `success`. Derive status from the child's emitted JSON when present, resolve with the structured result (preserving findings) and only reject on a genuine crash.

**Files:**
- Modify: `src/agents/subagent-manager.ts` (exit handler 112-150)
- Test: `tests/agents/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `SubagentResult` (`status: "success" | "failed" | "rejected"`).
- Produces: `spawn()` resolves with the child's structured `SubagentResult` (status trusted from `parsed.status` when present); rejects only when no structured result exists AND exit code ≠ 0.

- [ ] **Step 1: Write the failing tests** in `tests/agents/subagent-manager.test.ts` (use the file's existing `spawnOverride` fixture pattern):

```ts
test("manager resolves with the child's failed status instead of overriding to success", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "failed", findings: [], events: [], error: "write blocked" })); process.exit(1);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "write blocked");
});

test("manager resolves with failed status even on exit 0 when the child reports failed", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "failed", findings: [], events: [], error: "no writes applied" })); process.exit(0);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "failed");
});
```

Note the exit-0 test exercises the "defense in depth" path (the child's exit code is unreliable). Existing tests asserting exit-0 → success with no JSON output must remain green (fallback path).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: FAIL — current code derives `status: exitCode === 0 ? "success" : "failed"`, so the exit-0 test reports `success`, and the exit-1 test rejects (spawn throws) instead of resolving.

- [ ] **Step 3: Implement** in the exit handler (replace lines 126-149):

```ts
const status: SubagentResult["status"] =
  parsed?.status === "success" || parsed?.status === "failed" || parsed?.status === "rejected"
    ? parsed.status
    : exitCode === 0 ? "success" : "failed";

const result: SubagentResult = {
  id: task.id,
  role: task.role,
  status,
  findings: parsed?.findings ?? [],
  events: parsed?.events ?? [],
  error: status !== "success" ? (parsed?.error || stderr || `Exit code ${exitCode}`) : undefined,
};

for (const cb of this.callbacks) cb(result);
this.options.eventLog?.append({
  sessionId: this.options.sessionId,
  actor: "system",
  type: "subagent.result",
  payload: { role: task.role, taskId: task.id, status: result.status, findings: result.findings },
});

if (status === "success") {
  resolvePromise(result);
} else {
  reject(new Error(result.error ?? `Subagent exited with code ${exitCode}`));
}
```

Behavior change: a child that emits a structured `failed` result now resolves-with-`failed` (not reject), so `delegate-tool.ts`'s `result.status === "success"` branch is false and it returns `kind: "error"` WITH the findings intact (passed to `onResult` → `mergeCoordinator`). A crash (exit ≠ 0, no parseable JSON) still rejects with the stderr message.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: PASS (new + existing). Then `pnpm build && node --test dist/tests/agents/delegate-tool.test.js` — Expected PASS (mock-injected statuses unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-manager.ts tests/agents/subagent-manager.test.ts
git commit -m "fix(delegate): manager honors the subagent's reported status, preserving findings (#567)"
```

---

### Task 6: Regression, impact gate, and PR

**Files:** none (verification + release).

- [ ] **Step 1: Run the full affected test suites**

```bash
pnpm build && node --test dist/tests/patch/patch-parser.test.js dist/tests/patch-engine.test.js dist/tests/patch-tools.test.js dist/tests/policy/policy-gate.test.js dist/tests/executor.test.js dist/tests/runtime/execution-authorization.test.js dist/tests/agents/subagent-cli.test.js dist/tests/agents/subagent-manager.test.js dist/tests/agents/delegate-tool.test.js
```

Expected: all PASS. Then run the wider `.test.ts` suite per the handoff convention and confirm no NEW failures beyond the known pre-existing ones.

- [ ] **Step 2: Live-verify the worker path (best effort — needs a configured provider)**

Drive the write-mode worker against a scratch file with the deepseek provider:

```bash
node dist/src/agents/subagent-cli.js --subagent worker --task-id v1 --prompt "change the constant to 42 in scratch.ts" --mode write --session-id v1 --owned-paths scratch.ts
```

Confirm: (a) a unified-diff patch applies (`patch.applied`), (b) no `Approval required but no approval store configured` error, (c) `status: "success"` only when `scratch.ts` actually changed; inject a format-drift prompt and confirm `status: "failed"` + non-zero exit. If no provider is configured, document this as not-run and rely on the executor tests.

- [ ] **Step 3: GitNexus impact + detect_changes**

Run `detect_changes({ scope: "compare", base_ref: "main" })` and confirm only expected symbols/flows changed. Run `impact` (upstream) on the edited symbols if the index has been refreshed; warn the user on HIGH/CRITICAL blast radius. (The index is stale — a degraded result is expected; fall back to grep for direct callers of `applyPatch`, `ToolExecutor`, `PolicyGate.evaluateToolCall`, `SubagentManager.spawn`, `SubagentCLI.main` and report them.)

- [ ] **Step 4: Open the PR**

Follow `finishing-a-development-branch` (superpowers). Squash-merge, matching the repo convention (PR #564 was squash-merged). Reference `#565 #566 #567` and `Closes` all three in the PR body. Update memory: add `delegate-runtime-hardening-565-567-complete.md` following the established pattern, and update `MEMORY.md`.

---

## Self-review notes (write-after)

- **Spec coverage:** #565 engine + surface (Tasks 1-2), #566 owned-path rule + wiring (Task 3), #567 child + manager honesty (Tasks 4-5), release (Task 6). All three issue bodies' reproduction paths are addressed.
- **Placeholder scan:** no TBD/TODO; every code step carries its implementation.
- **Type consistency:** `computeSubagentStatus(fatalWriteFailures: string[])` and `subagentToolError(result)` names match their usages in Task 4. `ownedPaths` is consistently `string[] | undefined` across `ToolPolicyRequest`, `ExecutionDecisionRequest`, `ToolExecutor` param 10, and `subagent-cli`. `fpath()` in Task 1 is used by both `applyPatchBody` and `extractPatchFiles`.
- **Known intentional divergences from the Plan-agent draft:** #567 uses failed-on-tool-failure only (no `writeLanded` evidence requirement — user decision); `SubagentManager` resolves-with-failed-result to preserve findings (not reject); the catch/exception site stays on stderr for human visibility while the JSON result goes to stdout.
