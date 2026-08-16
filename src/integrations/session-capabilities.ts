import type { CapabilityRegistry } from "../capability/registry.js";
import type { NativeExecutor } from "../capability/executors.js";

/** Wires real session implementation behind core.session.*.
 * Lives in src/integrations/ — NOT capability package — so
 * platform core stays free domain dependencies. */
export async function registerSessionCapabilities(reg: Pick<CapabilityRegistry, 'register'>, native: NativeExecutor): Promise<void> {
  const { listSessions, sessionInfo } = await import("../session/resume.js");

  native.registerHandler("core.session.list", async (_args, ctx) => {
    const sessions = await listSessions(ctx.cwd);
    return { output: sessions };
  });

  native.registerHandler("core.session.show", async (args, ctx) => {
    const sessionId = args.sessionId as string | undefined;
    if (!sessionId) return { error: "sessionId argument required" };
    const info = await sessionInfo(ctx.cwd, sessionId);
    if (!info) return { error: `Session not found: ${sessionId}` };
    return { output: info };
  });

  // Phase 3 (#308): a composed capability. `core.session.summary` depends on
  // `core.session.list` — the runtime runs the dependency first, and its
  // output (the session array) becomes this handler's input. Observable in
  // the TUI palette like any other capability.
  reg.register({
    id: "core.session.summary", version: "1.0", kind: "core",
    title: "Session summary", description: "Count sessions by listing them (composition demo)",
    tags: ["session", "summary", "composed"], category: "session", risk: "low",
    requiredPermissions: ["operator"],
    dependencies: ["core.session.list"],
    resultSchema: {
      type: "object",
      properties: { total: { type: "number" }, first: { type: "string" } },
    },
    execution: { strategy: "native", timeout: 10_000, cancellable: true },
  });
  native.registerHandler("core.session.summary", async (args) => {
    // args is the dependency's output (the session list array).
    const sessions = Array.isArray(args) ? args : [];
    const total = sessions.length;
    const first = total > 0 ? (sessions[0] as { sessionId?: string })?.sessionId ?? "n/a" : "none";
    return { output: { total, first } };
  });
}
