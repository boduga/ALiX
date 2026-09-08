/**
 * tests/tracing/langfuse-boundary.vitest.ts
 *
 * Langfuse architectural boundary regression test (Task 22). Static source
 * scan asserting the runtime tree never couples to the Langfuse SDK outside
 * the tracing facade.
 *
 * Boundary contract (design §1, §3 "only", src/tracing/AGENTS.md "Dependency
 * direction"):
 *
 *   1. The ONLY file allowed to STATICALLY import "langfuse" (or a
 *      "langfuse/..." submodule) is src/tracing/langfuse-client.ts — the
 *      adapter — and it MUST contain such an import. Any other static
 *      `langfuse` import anywhere under src/ is a violation.
 *
 *   2. The ONLY file allowed a DYNAMIC `import("langfuse")` (T10 lazy-load):
 *      a direct dynamic import of the SDK is the design of
 *      src/tracing/client-factory.ts (Task 10 fix 5306a39f). Today the
 *      factory's enabled branch dynamic-imports `./langfuse-client.js` (and
 *      through it the SDK graph on the enabled path) rather than the package
 *      directly, so no dynamic SDK import currently exists anywhere.
 *
 *   3. src/tracing/langfuse-client.ts is INTERNAL to src/tracing/. No module
 *      outside src/tracing/ may import it (static OR dynamic) — consumers
 *      (src/agent, src/providers, src/tools, src/run, everywhere) reach the
 *      facade only via src/tracing/client.ts (TraceClient interface), the
 *      factory (getProcessTraceClient / createTraceClient), or the ALiX-shaped
 *      types (src/tracing/types.ts). Nothing imports the adapter.
 *
 *   4. The four instrumented seams — src/agent/agent-loop.ts, src/agent/
 *      session.ts, src/providers/provider-contract-validation.ts,
 *      src/tools/executor.ts — import ONLY from the facade surface
 *      (tracing/client, tracing/client-factory, tracing/types). Spot-pinned
 *      here so a reviewer can read the exact specifiers.
 *
 * Detection is LINE-ANCHORED against actual import statements, never a bare
 * word search, so docs/comments/strings that merely mention "langfuse" cannot
 * false-positive. Matched forms:
 *   - `from "langfuse"` / `from "langfuse/xyz"`       (static import)
 *   - `import "langfuse"`                              (static side-effect)
 *   - `require("langfuse")`                            (CJS, defensive)
 *   - `import("langfuse")` / `await import("langfuse")` (dynamic — allowed in
 *     the factory only, absent today)
 *
 * Layering with Task 20's runtime probe: this file is the STATIC boundary
 * scan — it catches a compile-time `import "langfuse"` even in a module T20's
 * harness never imports. T20's `tracing-disabled-misconfigured.vitest.ts`
 * module-evaluation probes are the RUNTIME witness (a static import on the
 * seam graph would evaluate the SDK on the disabled path and bump its
 * counters). Static scan first, runtime eval probe second — together they
 * pin both the import surface and its zero-evaluation guarantee.
 *
 * Task 22 — .superpowers/sdd/2026-09-06-langfuse-tracing-implementation-plan.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";

// ---------------------------------------------------------------------------
// Scope + allowlist
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

/** The adapter — the repo's single SDK-importing file (design §1). */
const ALLOWED_ADAPTER = "tracing/langfuse-client.ts";
/** The only file a dynamic `import("langfuse")` is designed for (T10). */
const ALLOWED_DYNAMIC_FACTORY = "tracing/client-factory.ts";

// All runtime sources, relative to SRC. Scans src/ only (dist/ is build
// output of src and would double-report); skips declaration files. No test
// files live under src/ today; if one ever lands, the boundary-asserted
// subtree is runtime code only, so tests (which vi.mock("langfuse")) are out
// of scope by construction — tests/ is never scanned.
const SRC_FILES = globSync("**/*.{ts,tsx}", {
  cwd: SRC,
  ignore: ["**/node_modules/**"],
}).filter((f) => !f.endsWith(".d.ts"));

// ---------------------------------------------------------------------------
// Line-anchored import matchers. All "langfuse" token matches below are on
// real import statements only, so a doc block that says "import langfuse"
// (no statement shape) or a string mentioning langfuse can never trip them.
// ---------------------------------------------------------------------------

/** Static `... from "langfuse"` / `from "langfuse/...` (and single quotes). */
const STATIC_SDK_IMPORT = /^\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']langfuse(?:\/|["'])/m;

/** Static side-effect `import "langfuse";` — no `from` clause. */
const SIDE_EFFECT_SDK_IMPORT = /^\s*import\s+["']langfuse(?:\/|["'])/m;

/** Defensive CJS: `require("langfuse")` / `require('langfuse/...')`. */
const REQUIRE_SDK_IMPORT = /require\(\s*["']langfuse(?:\/|["'])/;

/** Dynamic `import("langfuse")` / `await import("langfuse/...")`. */
const DYNAMIC_SDK_IMPORT = /(?:^|[\s;])(?:await\s+)?import\s*\(\s*["']langfuse(?:\/|["'])/m;

/** Static import of the adapter (the `./langfuse-client.js` family). */
const STATIC_ADAPTER_IMPORT = /^\s*(?:import|export)\b[\s\S]*?\bfrom\s+["'][^"']*langfuse-client/m;

/** Dynamic import of the adapter (`import("./langfuse-client.js")`). */
const DYNAMIC_ADAPTER_IMPORT = /(?:^|[\s;])(?:await\s+)?import\s*\(\s*["'][^"']*\blangfuse-client/m;

function readRel(rel: string): string {
  return readFileSync(join(SRC, rel), "utf-8");
}

/** Return `line: trimmed` for every line of `content` matching `re`. */
function matchedLines(content: string, re: RegExp): string[] {
  const hits: string[] = [];
  content.split("\n").forEach((raw, i) => {
    if (re.test(raw)) hits.push(`${i + 1}: ${raw.trim()}`);
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Boundary assertions
// ---------------------------------------------------------------------------

describe("Langfuse architectural boundary (Task 22)", () => {
  // ---------------------------------------------------------------------
  // 1. Only the adapter may import the SDK — and it must.
  // ---------------------------------------------------------------------
  it("only src/tracing/langfuse-client.ts imports the langfuse SDK (static & require)", () => {
    const violations: string[] = [];

    for (const rel of SRC_FILES) {
      if (rel === ALLOWED_ADAPTER) continue;
      const src = readRel(rel);
      for (const line of [
        ...matchedLines(src, STATIC_SDK_IMPORT),
        ...matchedLines(src, SIDE_EFFECT_SDK_IMPORT),
        ...matchedLines(src, REQUIRE_SDK_IMPORT),
      ]) {
        violations.push(`${rel}: ${line}`);
      }
    }

    expect(violations, `outside ${ALLOWED_ADAPTER}, found ${violations.length} langfuse import(s)`).toEqual([]);
  });

  it("src/tracing/langfuse-client.ts DOES statically import the langfuse SDK", () => {
    const adapter = readRel(ALLOWED_ADAPTER);
    const lines = [
      ...matchedLines(adapter, STATIC_SDK_IMPORT),
      ...matchedLines(adapter, SIDE_EFFECT_SDK_IMPORT),
      ...matchedLines(adapter, REQUIRE_SDK_IMPORT),
    ];
    expect(lines, `${ALLOWED_ADAPTER} must statically import the SDK`).not.toEqual([]);
  });

  // ---------------------------------------------------------------------
  // 2. Dynamic SDK import is allowed in the factory only (T10 lazy-load).
  // ---------------------------------------------------------------------
  it("a dynamic import(\"langfuse\") exists nowhere except the client factory (T10)", () => {
    const violations: string[] = [];

    for (const rel of SRC_FILES) {
      if (rel === ALLOWED_DYNAMIC_FACTORY) continue;
      for (const line of matchedLines(readRel(rel), DYNAMIC_SDK_IMPORT)) {
        violations.push(`${rel}: ${line}`);
      }
    }

    expect(violations, `outside ${ALLOWED_DYNAMIC_FACTORY}, found ${violations.length} dynamic langfuse import(s)`).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // 3. The adapter is internal to src/tracing/ — no consumer imports it.
  // ---------------------------------------------------------------------
  it("no module outside src/tracing/ imports langfuse-client (the adapter is internal)", () => {
    const violations: string[] = [];

    for (const rel of SRC_FILES) {
      if (rel.startsWith("tracing/")) continue;
      const src = readRel(rel);
      for (const line of [
        ...matchedLines(src, STATIC_ADAPTER_IMPORT),
        ...matchedLines(src, DYNAMIC_ADAPTER_IMPORT),
      ]) {
        violations.push(`${rel}: ${line}`);
      }
    }

    expect(violations, `outside src/tracing/, found ${violations.length} langfuse-client reference(s)`).toEqual([]);
  });

  it("spot-check: the sanctioned consumer seams (agent/providers/tools/run) never name the adapter", () => {
    const seamDirs = ["agent", "providers", "tools", "run"];
    const offending: string[] = [];

    for (const dir of seamDirs) {
      for (const rel of SRC_FILES) {
        if (!rel.startsWith(`${dir}/`)) continue;
        const src = readRel(rel);
        for (const line of [
          ...matchedLines(src, STATIC_ADAPTER_IMPORT),
          ...matchedLines(src, DYNAMIC_ADAPTER_IMPORT),
        ]) {
          offending.push(`${rel}: ${line}`);
        }
      }
    }

    expect(offending, `${seamDirs.join("/")} must reach tracing only through the facade`).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // 4. The four instrumented seams import ONLY the facade surface.
  //    Facade surface = client.ts (TraceClient) / client-factory.ts /
  //    types.ts, PLUS the frozen Noop singleton from noop-client.ts
  //    (pure, SDK-free — session.ts:89 uses it as the `config.traceClient`
  //    default since Task 10). The adapter (langfuse-client.ts) is NEVER a
  //    legal consumer target.
  // ---------------------------------------------------------------------
  const SEAM_FILES: Array<{ rel: string; facadeOnly: string[] }> = [
    // agent-loop: factory (createTraceClient) + types
    {
      rel: "agent/agent-loop.ts",
      facadeOnly: ["tracing/client-factory", "tracing/client", "tracing/types"],
    },
    // session: TraceClient interface + types + Noop default (Task 10)
    {
      rel: "agent/session.ts",
      facadeOnly: ["tracing/client-factory", "tracing/client", "tracing/types", "tracing/noop-client"],
    },
    // provider wrapper: factory (getProcessTraceClient) + interface + types
    {
      rel: "providers/provider-contract-validation.ts",
      facadeOnly: ["tracing/client-factory", "tracing/client", "tracing/types"],
    },
    // tool executor: factory (getProcessTraceClient) + interface + types
    {
      rel: "tools/executor.ts",
      facadeOnly: ["tracing/client-factory", "tracing/client", "tracing/types"],
    },
  ];

  for (const { rel, facadeOnly } of SEAM_FILES) {
    it(`${rel} reaches tracing ONLY via the facade (client / client-factory / types)`, () => {
      const src = readRel(rel);
      // Specifier-anchored: every line that names a tracing/ import target
      // (import/export/require/import() — including a multiline import's
      // `} from "../tracing/types.js"` continuation line). Comment-only lines
      // are excluded.
      const tracingSpecifierLines = src
        .split("\n")
        .map((raw, i) => ({ raw, i }))
        .filter(({ raw }) => /["'](?:\.\.\/|\.\/)tracing\//.test(raw))
        .filter(({ raw }) => !/^\s*(?:\/\/|\*|\/\*)/.test(raw));

      const violations: string[] = [];
      for (const { raw, i } of tracingSpecifierLines) {
        if (!facadeOnly.some((surface) => raw.includes(surface))) {
          violations.push(`${i + 1}: ${raw.trim()}`);
        }
      }

      expect(
        violations,
        `${rel} imports a non-facade tracing surface`,
      ).toEqual([]);
    });
  }
});