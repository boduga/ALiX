/**
 * THE PARITY TABLE for the model-callable tool surface.
 *
 * Adding or removing a tool changes what the model may CALL, which is an
 * authorization surface governed by the root AGENTS.md rule "Authorization
 * changes get a parity check, never a spot check". This branch removed a tool
 * (`dir.search`) and added a new name (`alix_hook_create` for `hook.create`)
 * with only spot checks — an assertion that `dir.search` is unroutable — which
 * by construction cannot detect a tool that silently vanished from any OTHER
 * surface.
 *
 * So every surface is enumerated exhaustively, in both directions:
 *   1. manifest  -> what the model may be offered
 *   2. registry  -> what is authorized and routable
 *   3. policy    -> what a role may be allowed
 *   4. read-only -> what `--read-only` may be offered
 * A tool present on one surface and absent from another is a defect, and each
 * direction is asserted separately so a removal cannot pass by being absent
 * everywhere.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALIX_BUILTIN_EXECUTORS, type AlixBuiltinToolName } from "../../src/agents/tool-manifest.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import { NON_WRITE_TOOLS, WRITE_TOOLS } from "../../src/agents/tool-policy.js";
import { READ_ONLY_TOOL_NAMES } from "../../src/run/helpers.js";

const manifestNames = (Object.keys(ALIX_BUILTIN_EXECUTORS) as AlixBuiltinToolName[]).sort();
const registryNames = buildDefaultToolIndex().registry.getAll().map((t) => t.name).sort();

/** The manifest names a tool must be routable; registry-only names are legacy. */
/** Intercepted in event-handlers before the policy gate; never registry-routed. */
const INTERCEPTED = new Set(["alix_mcp_search_tools", "alix_execution_state_propose"]);
/** Bound tools that bypass `filterTools` entirely; never policy-classified. */
const BOUND = manifestNames.filter((n) => n.startsWith("alix_collaboration_"));
/** Handled INLINE in `filterTools` (gated on `policy.allowMcpTools`), not by a set. */
const INLINE = new Set(["alix_mcp_search_tools", "alix_done"]);
/** Manifest name -> executor id, for names that reach a router. */
const executorOf = (n: string) => ALIX_BUILTIN_EXECUTORS[n as AlixBuiltinToolName];

/**
 * Executor ids the manifest points at, ignoring the registry. An earlier draft
 * computed `routed` by intersecting with registry membership, which made the
 * assertion circular: an executor dropped FROM the registry silently left the
 * expected list and the actual list agreeing on its absence. Deriving from the
 * manifest alone means a registry deletion shows up as a difference.
 */
const manifestExecutorIds = manifestNames
  .filter((n) => !INTERCEPTED.has(n) && !BOUND.includes(n))
  .map(executorOf)
  .sort();
/** Names in NEITHER set are the unclassified ones; a built-in may not be one. */
const classified = [...WRITE_TOOLS, ...NON_WRITE_TOOLS].sort();

describe("tool authorization parity", () => {
  it("every manifest tool is classified into exactly one policy set", () => {
    for (const name of manifestNames) {
      if (BOUND.includes(name) || INLINE.has(name)) continue;
      const inWrite = WRITE_TOOLS.has(name);
      const inNonWrite = NON_WRITE_TOOLS.has(name);
      assert.ok(inWrite !== inNonWrite, `${name} must be in exactly one policy set`);
    }
  });

  it("pins the WRITE / NON_WRITE partition, not just its union", () => {
    // Pinning the union is not enough: `filterTools` maps the two sets onto
    // distinct `allowedCategories`, so moving a tool from one to the other
    // changes what a role may call while the union is byte-identical. Each side
    // is pinned separately so that reclassification cannot pass unnoticed.
    assert.deepStrictEqual([...WRITE_TOOLS].sort(), [
      "alix_coordination_run",
      "alix_create_skill",
      "alix_delegate",
      "alix_execution_state_propose",
      "alix_file_create",
      "alix_file_delete",
      "alix_hook_create",
      "alix_patch_apply",
      "alix_schedule_propose",
    ]);
    assert.deepStrictEqual([...NON_WRITE_TOOLS].sort(), [
      "alix_coordination_list",
      "alix_coordination_results",
      "alix_coordination_status",
      "alix_done",
      "alix_file_exists",
      "alix_file_read",
      "alix_glob_match",
      "alix_grep_search",
      "alix_inspect_extension",
      "alix_list_extensions",
      "alix_shell_run",
      "alix_state_query",
      "alix_verify_claim",
      "alix_web_fetch",
      "alix_web_search",
    ]);
  });

  it("no registry entry exists without a model-facing name (the dir.search shape)", () => {
    // The reverse direction, and the one that actually mattered: `dir.search`
    // was dispatchable with NO name the model could ever call, so it was
    // reachable code that no prompt, policy set, or manifest entry could
    // authorize. Checking manifest -> registry cannot see that shape at all,
    // because the manifest was never involved. Every registry entry must be the
    // executor id of some manifest name, or it is unroutable dead authority.
    const manifestExecutorSet = new Set<string>(Object.values(ALIX_BUILTIN_EXECUTORS));
    for (const exec of registryNames) {
      // `mcp.*` is the dynamic-MCP wildcard executor. Its names are minted per
      // turn and cannot be declared in the manifest by construction, so it is
      // exempt for the same reason the resolver treats MCP handles specially.
      if (exec === "mcp.*") continue;
      assert.ok(
        manifestExecutorSet.has(exec),
        `registry entry ${exec} has no model-facing name; it cannot be authorized`,
      );
    }
  });

  it("no policy set names a tool absent from the manifest", () => {
    const known = new Set(manifestNames);
    for (const name of classified) {
      assert.ok(known.has(name as AlixBuiltinToolName), `policy set names ${name}, which the manifest does not`);
    }
  });

  it("every read-only name is offered in the manifest and classified", () => {
    const known = new Set(manifestNames);
    const policy = new Set(classified);
    for (const name of READ_ONLY_TOOL_NAMES) {
      assert.ok(known.has(name as AlixBuiltinToolName), `read-only surface offers ${name}, absent from the manifest`);
      // `alix_done` / `alix_mcp_search_tools` are decided inline in filterTools.
      if (INLINE.has(name)) continue;
      assert.ok(policy.has(name), `read-only surface offers ${name}, unclassified by policy`);
    }
  });

  it("every manifest tool the router can execute resolves to a registry entry", () => {
    // A tool offered to the model but absent from the registry is unroutable at
    // runtime: `dir.search` was exactly that shape before its deletion.
    for (const name of manifestNames) {
      const exec = ALIX_BUILTIN_EXECUTORS[name];
      if (BOUND.includes(name) || INTERCEPTED.has(name)) continue;
      assert.ok(registryNames.includes(exec), `${name} -> ${exec} is not routable`);
    }
  });

  it("pins the complete classified surface, so a removal cannot pass silently", () => {
    // Broader than the implementation on purpose: this is the input space. A
    // new tool must be added here deliberately (it gains authority), and a
    // removed tool must be deleted here deliberately (it loses authority).
    assert.deepStrictEqual(classified, [
      "alix_coordination_list",
      "alix_coordination_results",
      "alix_coordination_run",
      "alix_coordination_status",
      "alix_create_skill",
      "alix_delegate",
      "alix_done",
      "alix_execution_state_propose",
      "alix_file_create",
      "alix_file_delete",
      "alix_file_exists",
      "alix_file_read",
      "alix_glob_match",
      "alix_grep_search",
      "alix_hook_create",
      "alix_inspect_extension",
      "alix_list_extensions",
      "alix_patch_apply",
      "alix_schedule_propose",
      "alix_shell_run",
      "alix_state_query",
      "alix_verify_claim",
      "alix_web_fetch",
      "alix_web_search",
    ]);
  });

  it("pins the read-only surface in full", () => {
    assert.deepStrictEqual([...READ_ONLY_TOOL_NAMES].sort(), [
      "alix_done",
      "alix_file_exists",
      "alix_file_read",
      "alix_glob_match",
      "alix_grep_search",
      "alix_mcp_search_tools",
      "alix_shell_run",
      "alix_verify_claim",
      "alix_web_fetch",
      "alix_web_search",
    ]);
  });

  it("pins the routed executor-id surface in full", () => {
    // Executor IDs, NOT capability keys — the registry's `name` is the dispatch
    // identity. An earlier draft of this table listed capability ids here,
    // which would have "passed" against any registry that happened to project
    // the same tools.
    assert.deepStrictEqual(
      manifestExecutorIds,
      [
        "coordination.list", "coordination.results", "coordination.run",
        "coordination.status", "delegate", "done", "extension.inspect",
        "extension.list", "file.create", "file.delete", "file.exists",
        "file.read", "glob.match", "grep.search", "hook.create",
        "patch.apply", "schedule.propose", "shell.run", "skill.create",
        "state.query", "verify.claim", "web.fetch", "web.search",
      ],
    );
  });
});
