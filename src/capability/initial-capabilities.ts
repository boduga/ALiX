// src/capability/initial-capabilities.ts
import type { Capability } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { NativeExecutor } from "./executors.js";

/** Session-native capability definitions — NO domain dependencies. This
 *  module intentionally holds core.session.* ONLY: tool capabilities are
 *  derived from the canonical tool registry (see registry-capabilities.ts,
 *  registerRegistryToolCapabilities) so the palette taxonomy cannot drift
 *  from the registry. Handlers are wired separately in src/integrations/
 *  (see session-capabilities.ts, tool-adapter.ts). */
export function registerInitialCapabilities(reg: Pick<CapabilityRegistry, 'register'>, _native: NativeExecutor): void {
  const caps: Capability[] = [
    {
      id: "core.session.list", version: "1.0", kind: "core",
      title: "List sessions", description: "List all ALiX sessions",
      tags: ["session", "list"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      // Phase 2 (#308): resultSchema powers structured rendering — the
      // presenter itemizes the returned session list instead of JSON.stringify.
      resultSchema: {
        type: "array",
        items: { type: "object", properties: { sessionId: { type: "string" }, createdAt: { type: "string" } } },
      },
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
    {
      id: "core.session.show", version: "1.0", kind: "core",
      title: "Show session", description: "Show details for one session",
      tags: ["session", "show"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      argsSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      resultSchema: { type: "object", properties: { sessionId: { type: "string" }, state: { type: "string" } } },
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
  ];
  for (const cap of caps) reg.register(cap);
}
