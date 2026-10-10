// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * R1 boundary freeze — architecture/dependency test.
 *
 * Rejects NEW direct dependencies on protected implementations:
 * - direct-tool-dispatch: value imports of src/capabilities/tools/executor.ts
 * - status-store-writes: value imports of lifecycle status stores
 * - eventlog-append-producers: value imports of src/runtime-state/events/event-log.ts
 * - ownership-registry-construction: value imports of ownership registries
 * - model-resolver-impls: new model-resolution definitions
 * - tool-taxonomy-defs: new tool taxonomy definitions
 * - metrics-vocabs: new metrics vocabulary definitions
 * - ui-store-imports: UI (tui/ui/inspector) value imports of stores/executors/event-log
 *
 * Type-only imports (`import type`, type-position `import("...")`) are
 * exempt: the R1 ports in src/runtime-state/contracts/ reuse domain types that way.
 * Bare side-effect imports (`import "..."`) are exempt: they bind nothing
 * and cannot dispatch/append/acquire by themselves.
 *
 * Allowlist (tests/architecture/r1-allowlist.json) holds EXACT
 * file-level entries derived from R0. Shrink-only: a new violation fails,
 * a stale entry (no longer observed) fails, a duplicate triple fails,
 * and an entry without R0 reference + removal phase fails.
 *
 * @module r1-boundary-freeze
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowKey,
  loadAllowlist as loadSharedAllowlist,
  normalizeRepo,
  walkTs,
  type AllowEntry,
} from "./freeze-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// TS compiles tests/ → dist/tests/ so __dirname is dist/tests/architecture.
// 3 levels up from dist/tests/architecture/ reaches the repo root.
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");

const RULES = [
  "direct-tool-dispatch",
  "status-store-writes",
  "eventlog-append-producers",
  "ownership-registry-construction",
  "model-resolver-impls",
  "tool-taxonomy-defs",
  "metrics-vocabs",
  "ui-store-imports",
] as const;

const IMPORT_RULE_TARGETS: Record<string, string[]> = {
  "direct-tool-dispatch": ["src/capabilities/tools/executor.ts"],
  "status-store-writes": [
    "src/coordination/kernel/coordination-store.ts",
    "src/governance/approvals/approval-store.ts",
    "src/operations/daemon/task-registry.ts",
    "src/runtime-state/runtime/continuation-store.ts",
    "src/coordination/kernel/collaboration-store.ts",
    "src/execution/executive/execution-state-store.ts",
    "src/runtime-state/runtime/execution-state/execution-state-store.ts",
    "src/coordination/workflow/state-file.ts",
    "src/governance/execution-approval-store.ts",
  ],
  "eventlog-append-producers": ["src/runtime-state/events/event-log.ts"],
  "ownership-registry-construction": [
    "src/coordination/ownership/ownership-registry.ts",
  ],
};

/** Import rules: importer files sanctioned to import a protected target. */
const IMPORT_RULE_EXEMPT: Record<string, string[]> = {
  // R5.3b — the ONE sanctioned ToolExecutor construction seam.
  "direct-tool-dispatch": ["src/capabilities/tools/tool-executor-factory.ts"],
};

const UI_DIRS = ["src/interfaces/tui/", "src/interfaces/ui/", "src/interfaces/inspector/"];
const UI_RULE_TARGETS = [
  "src/coordination/kernel/coordination-store.ts",
  "src/governance/approvals/approval-store.ts",
  "src/operations/daemon/task-registry.ts",
  "src/runtime-state/runtime/continuation-store.ts",
  "src/coordination/kernel/collaboration-store.ts",
  "src/execution/executive/execution-state-store.ts",
  "src/runtime-state/runtime/execution-state/execution-state-store.ts",
  "src/coordination/workflow/state-file.ts",
  "src/governance/execution-approval-store.ts",
  "src/capabilities/tools/executor.ts",
  "src/runtime-state/events/event-log.ts",
  "src/coordination/ownership/ownership-registry.ts",
];

const DEF_RULES: Record<string, { files: string[]; symbols: string[]; marker: string; exempt?: string[] }> = {
  "model-resolver-impls": {
    // R5.2 — one canonical resolver module, exposed through the ModelResolver
    // port. Watch the canonical factory everywhere *except* its home module, so
    // a second resolver definition anywhere else fails the freeze.
    files: ["src/operations/config/model-resolver.ts"],
    symbols: ["createModelResolver"],
    exempt: ["src/operations/config/model-resolver.ts"],
    marker: "definition:model-resolution",
  },
  "tool-taxonomy-defs": {
    // R5.3 — one canonical tool catalogue (`src/capabilities/tools/tool-registry.ts`,
    // exposed through the ToolCapabilityRegistry port) plus the named
    // subsystems that adapt to it. The watched definitions are allowed only in
    // the home modules listed under `exempt` (rule-level, as `exempt` is a
    // file list); a definition outside them fails the freeze.
    files: [
      "src/capabilities/tools/tool-registry.ts",
      "src/capabilities/capability/registry.ts",
      "src/capabilities/registry/card-registry.ts",
      "src/capabilities/mcp/registry.ts",
      "src/agents/tool-manifest.ts",
    ],
    symbols: [
      "buildDefaultToolIndex",
      "createToolCapabilityRegistry",
      "ALIX_BUILTIN_EXECUTORS",
      "CapabilityRegistry",
      "CardRegistry",
      "McpToolRegistry",
    ],
    exempt: [
      "src/capabilities/tools/tool-registry.ts",
      "src/capabilities/capability/registry.ts",
      "src/capabilities/registry/card-registry.ts",
      "src/capabilities/mcp/registry.ts",
      "src/agents/tool-manifest.ts",
    ],
    marker: "definition:tool-taxonomy",
  },
  "metrics-vocabs": {
    // R5.4 — one metric-observation vocabulary through the `MetricsSink` port.
    // The four named vocabularies are distinct concerns (kernel counters,
    // registry definitions, tracing spans, daemon snapshots); each definition
    // is allowed only in its home module.
    files: [
      "src/coordination/kernel/minimal-metrics.ts",
      "src/operations/observability/metric-registry.ts",
      "src/models/tracing/client-factory.ts",
      "src/interfaces/tui/daemon-metrics-collector.ts",
    ],
    symbols: [
      "MinimalMetrics",
      "createMetricRegistry",
      "getProcessTraceClient",
      "createTraceClient",
      "DaemonMetricsCollectorImpl",
    ],
    exempt: [
      "src/coordination/kernel/minimal-metrics.ts",
      "src/operations/observability/metric-registry.ts",
      "src/models/tracing/client-factory.ts",
      "src/interfaces/tui/daemon-metrics-collector.ts",
    ],
    marker: "definition:metrics-vocabulary",
  },
};

function resolveSpecifier(importerFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const abs = resolve(dirname(importerFile), spec);
  let rel = normalizeRepo(relative(PROJECT_ROOT, abs));
  if (rel.endsWith(".js")) {
    const tsGuess = rel.slice(0, -3) + ".ts";
    if (existsSync(resolve(PROJECT_ROOT, tsGuess))) rel = tsGuess;
  }
  return rel;
}

function isBareSideEffect(line: string): boolean {
  return /^\s*import\s+["']/.test(line);
}

function isTypeOnly(line: string): boolean {
  return /^\s*import\s+type\b/.test(line);
}

function isTypePositionDynamic(line: string): boolean {
  // import("...") inside a type annotation: `?:`, `:`, Awaited<, ReturnType<, Promise<, generics.
  return /[?:]\s*import\(|Awaited<|ReturnType<|Promise<[^>]*import\(|<\s*import\(/.test(line);
}

type Violation = { rule: string; importer: string; imported: string };

function scanImports(): Violation[] {
  const files: string[] = [];
  walkTs(SRC_ROOT, files);
  const found = new Map<string, Violation>();
  const staticFrom = /from\s+["']([^"']+)["']/g;
  const awaitImport = /await\s+import\(["']([^"']+)["']\)/g;
  const bareImport = /import\(["']([^"']+)["']\)/g;

  for (const file of files) {
    const importer = normalizeRepo(relative(PROJECT_ROOT, file));
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (isTypeOnly(line) || isBareSideEffect(line)) continue;
      const specs = new Set<string>();
      staticFrom.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = staticFrom.exec(line)) !== null) specs.add(m[1]);
      awaitImport.lastIndex = 0;
      while ((m = awaitImport.exec(line)) !== null) specs.add(m[1]);
      // Bare import() in expression position (e.g. inside Promise.all).
      // Skip type-position uses (annotated with :, ?:, Awaited<, ReturnType<).
      if (!isTypePositionDynamic(line)) {
        bareImport.lastIndex = 0;
        while ((m = bareImport.exec(line)) !== null) specs.add(m[1]);
      }
      for (const spec of specs) {
        const resolved = resolveSpecifier(file, spec);
        if (!resolved) continue;
        for (const [rule, targets] of Object.entries(IMPORT_RULE_TARGETS)) {
          if (targets.some((t) => resolved === t || resolved.endsWith("/" + t))) {
            if (IMPORT_RULE_EXEMPT[rule]?.includes(importer)) continue;
            found.set(`${rule}|${importer}|${resolved}`, { rule, importer, imported: resolved });
          }
        }
        if (UI_DIRS.some((d) => importer.startsWith(d))) {
          if (UI_RULE_TARGETS.some((t) => resolved === t || resolved.endsWith("/" + t))) {
            found.set(`ui-store-imports|${importer}|${resolved}`, {
              rule: "ui-store-imports",
              importer,
              imported: resolved,
            });
          }
        }
      }
    }
  }
  return [...found.values()];
}

function scanDefinitions(): Violation[] {
  const files: string[] = [];
  walkTs(SRC_ROOT, files);
  const found = new Map<string, Violation>();
  const defRe =
    /export\s+(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  for (const file of files) {
    const importer = normalizeRepo(relative(PROJECT_ROOT, file));
    const content = readFileSync(file, "utf-8");
    const defined = new Set<string>();
    defRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = defRe.exec(content)) !== null) defined.add(m[1]);
    if (defined.size === 0) continue;
    for (const [rule, cfg] of Object.entries(DEF_RULES)) {
      if (cfg.exempt?.includes(importer)) continue;
      if (cfg.symbols.some((s) => defined.has(s))) {
        found.set(`${rule}|${importer}|${cfg.marker}`, {
          rule,
          importer,
          imported: cfg.marker,
        });
      }
    }
  }
  return [...found.values()];
}

function loadAllowlist(): AllowEntry[] {
  return loadSharedAllowlist(PROJECT_ROOT, "r1-allowlist.json");
}

function key(v: { rule: string; importer: string; imported: string }): string {
  return allowKey(v);
}

describe("R1 boundary freeze", () => {
  it("allowlist entries are well-formed with R0 reference and removal phase", () => {
    const list = loadAllowlist();
    assert.ok(Array.isArray(list) && list.length > 0, "allowlist must be non-empty");
    const seen = new Set<string>();
    for (const e of list) {
      assert.ok(
        (RULES as readonly string[]).includes(e.rule),
        `unknown rule: ${e.rule}`,
      );
      assert.ok(e.importer && e.imported, `entry needs importer+imported: ${e.rule}`);
      assert.ok(
        typeof e.reason === "string" && /R0\b/.test(e.reason),
        `entry lacks R0 reference: ${e.rule} ${e.importer} -> ${e.imported}`,
      );
      assert.ok(
        typeof e.removalPhase === "string" && /^R\d/.test(e.removalPhase),
        `entry lacks removal phase: ${e.rule} ${e.importer} -> ${e.imported}`,
      );
      const k = key(e);
      assert.ok(!seen.has(k), `duplicate allowlist entry: ${k}`);
      seen.add(k);
    }
  });

  it("no new violations beyond the exact allowlist", () => {
    const actual = [...scanImports(), ...scanDefinitions()];
    const allowed = new Set(loadAllowlist().map(key));
    const fresh = actual
      .filter((v) => !allowed.has(key(v)))
      .sort((a, b) => key(a).localeCompare(key(b)));
    assert.deepEqual(
      fresh,
      [],
      `new bypass(es) outside allowlist — add a port instead:\n${fresh.map((v) => `  ${key(v)}`).join("\n")}`,
    );
  });

  it("allowlist is shrink-only: no stale entries", () => {
    const actual = new Set([...scanImports(), ...scanDefinitions()].map(key));
    const stale = loadAllowlist()
      .map(key)
      .filter((k) => !actual.has(k))
      .sort();
    assert.deepEqual(
      stale,
      [],
      `stale allowlist entr(ies) — violation gone, remove entry:\n${stale.map((k) => `  ${k}`).join("\n")}`,
    );
  });

  it("ten R1 ports exist and compile as authority boundaries", () => {
    const ports = [
      "runtime-fact-port",
      "runtime-state-reader",
      "authorized-execution-port",
      "approval-decision-port",
      "ownership-authority",
      "agent-lifecycle-port",
      "model-resolver",
      "context-compiler",
      "tool-capability-registry",
      "metrics-sink",
    ];
    for (const p of ports) {
      const full = resolve(SRC_ROOT, "runtime-state", "contracts", `${p}.ts`);
      assert.ok(existsSync(full), `missing R1 port: src/runtime-state/contracts/${p}.ts`);
      const content = readFileSync(full, "utf-8");
      assert.ok(/export\s+interface\s+\w+/.test(content), `${p}.ts must export an interface`);
    }
  });
});
