// src/capability/initial-capabilities.ts
import type { Capability } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { NativeExecutor } from "./executors.js";

/** Pure capability definitions — NO domain dependencies. Existing ALiX
 *  functionality migrates behind these; handlers are wired separately in
 *  src/integrations/ (see session-capabilities.ts, tool-adapter.ts). */
export function registerInitialCapabilities(reg: CapabilityRegistry, _native: NativeExecutor): void {
  const caps: Capability[] = [
    {
      id: "core.session.list", version: "1.0", kind: "core",
      title: "List sessions", description: "List all ALiX sessions",
      tags: ["session", "list"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
    {
      id: "core.session.show", version: "1.0", kind: "core",
      title: "Show session", description: "Show details for one session",
      tags: ["session", "show"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      argsSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
    {
      id: "tool.file.read", version: "1.0", kind: "tool",
      title: "Read file", description: "Read the contents of a file",
      tags: ["file", "read"], category: "file", risk: "low",
      requiredPermissions: ["developer"],
      argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execution: { strategy: "tool", timeout: 10_000, cancellable: false },
      extensions: { toolName: "file.read" },
    },
    {
      id: "tool.shell.run", version: "1.0", kind: "tool",
      title: "Run shell command", description: "Execute a shell command",
      tags: ["shell", "run"], category: "shell", risk: "high",
      requiredPermissions: ["admin"],
      argsSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      execution: { strategy: "tool", timeout: 30_000, cancellable: true },
      extensions: { toolName: "shell.run" },
    },
  ];
  for (const cap of caps) reg.register(cap);
}
