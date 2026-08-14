// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-12 Task 1 — Bounded legacy migration fixture (data only).
 *
 * Hand-authored M-series `Capability` rows plus the canonical projection each
 * is expected to yield after `legacy-adapter.legacyToCanonicalDefinition` runs.
 *
 * Authoritative mappings (from production code, NOT spec paraphrase):
 *   - legacy kind → canonical kind: `src/capability/canonical/kind.ts:migrateKind`
 *       core    → core
 *       tool    → operation
 *       skill   → operation
 *       workflow → workflow
 *       plugin  → agent
 *       custom  → throws (no canonical equivalent)
 *   - legacy execution.strategy → canonical bindings[].type:
 *       `src/capability/legacy-adapter.ts:LEGACY_STRATEGY_TO_PROVIDER`
 *       native → native, tool → tool, mcp → mcp, cli → external-cli,
 *       daemon → daemon, agent → agent, plugin → plugin, remote-api → remote-api
 *   - version normalization: `legacy-adapter.legacyToCanonicalDefinition`
 *       2-part SemVer (`MAJOR.MINOR`) → 3-part (`MAJOR.MINOR.0`); else unchanged.
 *
 * Deviations from spec §4.3 paraphrase:
 *   - Row 1 (`tool.file.read`): spec says `→ query`; production `migrateKind`
 *     maps `tool → operation` for every legacy `tool` kind regardless of id.
 *     We follow the adapter. `expectedCanonical.kind = "operation"`.
 *   - Row 8 (deprecated): neither `Capability` nor `CapabilityDefinition` carry
 *     a top-level `lifecycle` field. The brief's interface used
 *     `Capability["lifecycle"]`, which does not exist. We model deprecation via
 *     `legacy.extensions.lifecycle` (which rides through `binding.config`), and
 *     surface the expected canonical annotation as a `string` on
 *     `expectedCanonical.lifecycle`.
 *
 * @module capability/fixtures/legacy-migration-bundle
 */

import type { Capability } from "../../../src/capability/types.js";
import type { CapabilityKind } from "../../../src/capability/canonical/kind.js";
import type { ProviderType } from "../../../src/capability/canonical/provider.js";

export interface LegacyMigrationRow {
  /** short label test ("tool-file-read → operation"). */
  readonly label: string;
  /** legacy M-series Capability object. */
  readonly legacy: Capability;
  /** expected canonical projection after `legacy-adapter.legacyToCanonicalDefinition`. */
  readonly expectedCanonical: {
    readonly id: string;
    readonly kind: CapabilityKind;
    /** Normalized SemVer MAJOR.MINOR.PATCH. */
    readonly version: string;
    readonly bindings: ReadonlyArray<{ readonly type: ProviderType }>;
    /**
     * Lifecycle annotation carried over from the legacy entry. Typed as
     * `string` because neither `Capability` nor `CapabilityDefinition` has a
     * `lifecycle` field; legacy deprecation rides through
     * `extensions.lifecycle` → `bindings[0].config.lifecycle`.
     */
    readonly lifecycle?: string;
  };
}

export const LEGACY_MIGRATION_BUNDLE: readonly LegacyMigrationRow[] = [
  // 1. tool/file.read — spec §4.3 says "→ query" but production maps tool→operation.
  {
    label: "tool-file-read → operation (spec suggests query; production wins)",
    legacy: {
      id: "tool.file.read",
      version: "1.0.0",
      kind: "tool",
      title: "Read file",
      description: "Read a file from disk and return its contents.",
      tags: ["file", "read"],
      category: "file",
      risk: "low",
      requiredPermissions: ["developer"],
      execution: { strategy: "tool", timeout: 10_000, cancellable: false },
      extensions: { toolName: "file.read" },
    },
    expectedCanonical: {
      id: "tool.file.read",
      kind: "operation",
      version: "1.0.0",
      bindings: [{ type: "tool" }],
    },
  },

  // 2. tool/git.commit — spec says "→ operation"; production matches.
  {
    label: "tool-git-commit → operation",
    legacy: {
      id: "tool.git.commit",
      version: "1.0.0",
      kind: "tool",
      title: "Git commit",
      description: "Create a git commit in the current repository.",
      tags: ["git", "vcs"],
      category: "vcs",
      risk: "medium",
      requiredPermissions: ["developer"],
      execution: { strategy: "tool", timeout: 30_000, cancellable: false },
      extensions: { toolName: "git.commit" },
    },
    expectedCanonical: {
      id: "tool.git.commit",
      kind: "operation",
      version: "1.0.0",
      bindings: [{ type: "tool" }],
    },
  },

  // 3. tool/shell.run — spec says "→ operation"; production matches.
  {
    label: "tool-shell-run → operation",
    legacy: {
      id: "tool.shell.run",
      version: "1.0.0",
      kind: "tool",
      title: "Shell run",
      description: "Execute a shell command and capture stdout/stderr.",
      tags: ["shell", "exec"],
      category: "shell",
      risk: "high",
      requiredPermissions: ["developer"],
      execution: { strategy: "tool", timeout: 60_000, cancellable: true },
      extensions: { toolName: "shell.run" },
    },
    expectedCanonical: {
      id: "tool.shell.run",
      kind: "operation",
      version: "1.0.0",
      bindings: [{ type: "tool" }],
    },
  },

  // 4. core/session.list — core→core, native→native.
  {
    label: "core-session-list → core",
    legacy: {
      id: "core.session.list",
      version: "2.0.0",
      kind: "core",
      title: "List sessions",
      description: "List all active operator sessions.",
      tags: ["session", "core"],
      category: "core",
      risk: "low",
      requiredPermissions: ["operator"],
      execution: { strategy: "native", timeout: 5_000 },
    },
    expectedCanonical: {
      id: "core.session.list",
      kind: "core",
      version: "2.0.0",
      bindings: [{ type: "native" }],
    },
  },

  // 5. workflow/deploy — workflow→workflow, cli→external-cli (the only rename).
  {
    label: "workflow-deploy → workflow (strategy renamed cli → external-cli)",
    legacy: {
      id: "workflow.deploy",
      version: "3.0.0",
      kind: "workflow",
      title: "Deploy workflow",
      description: "Run the deployment workflow.",
      tags: ["deploy", "workflow"],
      category: "deploy",
      risk: "high",
      requiredPermissions: ["admin"],
      execution: { strategy: "cli", timeout: 300_000 },
      extensions: { executable: "deploy.sh" },
    },
    expectedCanonical: {
      id: "workflow.deploy",
      kind: "workflow",
      version: "3.0.0",
      bindings: [{ type: "external-cli" }],
    },
  },

  // 6. plugin/orchestrate — plugin→agent (production). Spec's "agent → plugin"
  //    phrasing is the reverse direction; production is authoritative.
  {
    label: "plugin-orchestrate → agent",
    legacy: {
      id: "plugin.orchestrate",
      version: "1.0.0",
      kind: "plugin",
      title: "Orchestrate",
      description: "Coordinate multi-agent task execution.",
      tags: ["orchestration", "agent"],
      category: "agent",
      risk: "medium",
      requiredPermissions: ["developer"],
      execution: { strategy: "agent", timeout: 120_000, cancellable: true },
      extensions: { agentName: "orchestrator" },
    },
    expectedCanonical: {
      id: "plugin.orchestrate",
      kind: "agent",
      version: "1.0.0",
      bindings: [{ type: "agent" }],
    },
  },

  // 7. tool with unnormalized 2-part version "1.0" — adapter must normalize to "1.0.0".
  //    Strategy is mcp → mcp.
  {
    label: "tool-mcp with unnormalized version 1.0 → 1.0.0",
    legacy: {
      id: "tool.mcp.discover",
      version: "1.0",
      kind: "tool",
      title: "MCP discover",
      description: "Discover capabilities exposed by an MCP server.",
      tags: ["mcp"],
      category: "mcp",
      risk: "low",
      requiredPermissions: ["developer"],
      execution: { strategy: "mcp", timeout: 15_000 },
      extensions: { serverName: "example-mcp" },
    },
    expectedCanonical: {
      id: "tool.mcp.discover",
      kind: "operation",
      version: "1.0.0",
      bindings: [{ type: "mcp" }],
    },
  },

  // 8. Deprecated tool entry — lifecycle rides via extensions → binding.config.
  //    Neither Capability nor CapabilityDefinition has a top-level lifecycle
  //    field, so deprecation flows through the legacy extensions carrier.
  {
    label: "tool-deprecated → operation (lifecycle: deprecated)",
    legacy: {
      id: "tool.legacy.scan",
      version: "1.0.0",
      kind: "tool",
      title: "Legacy scanner (deprecated)",
      description: "Legacy file scanner — superseded by tool.file.list.",
      tags: ["file", "scan", "deprecated"],
      category: "file",
      risk: "low",
      requiredPermissions: ["developer"],
      execution: { strategy: "tool", timeout: 10_000 },
      extensions: { toolName: "file.scan", lifecycle: "deprecated" },
    },
    expectedCanonical: {
      id: "tool.legacy.scan",
      kind: "operation",
      version: "1.0.0",
      bindings: [{ type: "tool" }],
      lifecycle: "deprecated",
    },
  },
];
