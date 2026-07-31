import type { CapabilityRegistry } from "../capability/registry.js";
import type { NativeExecutor } from "../capability/executors.js";

/** Wires real session implementation behind core.session.*.
 * Lives in src/integrations/ — NOT capability package — so
 * platform core stays free domain dependencies. */
export async function registerSessionCapabilities(reg: CapabilityRegistry, native: NativeExecutor): Promise<void> {
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
}
