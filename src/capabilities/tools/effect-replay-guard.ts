import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shellExecutionDirectory } from "./shell-execution-directory.js";
import { hashArgs } from "./hash-args.js";
import type { ToolCallRequest, ToolResult } from "./types.js";
import { buildDefaultToolIndex } from "./tool-registry.js";
import { isSafeShellCommand } from "./safe-shell.js";
import { ExecutionCancelledError, signalReason } from "../../runtime-state/runtime/cancellation-token.js";

const registry = buildDefaultToolIndex().registry;

/** Host metadata controls coverage; model-supplied flags confer no exemption. */
export async function executeWithEffectReplayGuard(
  root: string,
  request: ToolCallRequest,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const metadata = registry.lookup(request.name.startsWith("mcp.") ? "mcp.*" : request.name);
  const safeShell = request.name === "shell.run"
    && typeof request.args.command === "string" && isSafeShellCommand(request.args.command);
  // Admission is not proof of no effects: git can write output, and rg's
  // --pre executes a program even when quoted like a search pattern. Keep rg
  // entirely outside the exemption rather than attempting to parse its flags.
  const readOnlyShell = safeShell
    && /^(?:pwd|echo|printf|date|whoami|id|ls|dir|cat|head|tail|wc|stat|file|md5sum|sha256sum|grep|which|type)(?:\s|$)/.test((request.args.command as string).trim());
  if (!metadata?.mutates || (metadata.risk !== "high" && metadata.risk !== "critical") || readOnlyShell) {
    return execute();
  }
  let effectArgs = request.args;
  if (request.name === "shell.run") {
    try {
      // The router enforces this same directory, including pool consistency.
      effectArgs = {
        command: request.args.command,
        cwd: shellExecutionDirectory(root, request.args.cwd, safeShell),
      };
    } catch {
      return { kind: "error", message: "Cannot establish shell execution directory", retryable: false };
    }
  }
  return guardEffectReplay(root, request.name, effectArgs, () => {
    if (request.signal?.aborted) throw new ExecutionCancelledError(signalReason(request.signal) ?? "tool cancelled");
    return execute();
  });
}

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * Bounded effect identity: canonical workspace + routed tool + exact repaired
 * arguments. Deliberately excludes session, worker, approval and invocation ids.
 * An exclusive durable marker is a claim, NOT a lock to reclaim by PID or age.
 */
export async function guardEffectReplay(
  root: string,
  name: string,
  args: Record<string, unknown>,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  let marker: string;
  let directory: string;
  try {
    const workspace = realpathSync(root);
    directory = join(workspace, ".alix", "effect-replay", "v1");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    marker = join(directory, `${hashArgs({ version: 1, workspace, name, args })}.json`);
    const fd = openSync(marker, "wx", 0o600);
    try {
      // Store no raw arguments (commands and plugin inputs can contain secrets).
      writeFileSync(fd, JSON.stringify({ version: 1, state: "unresolved", claimedAt: new Date().toISOString() }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    // Persist newly created directory entries BEFORE entering the adapter.
    syncDirectory(directory);
    syncDirectory(join(workspace, ".alix", "effect-replay"));
    syncDirectory(join(workspace, ".alix"));
    syncDirectory(workspace);
  } catch {
    // Includes existing/empty/corrupt claims, and inability to persist a claim.
    // Never infer permission from marker contents, age, PID, or an I/O failure.
    return {
      kind: "error", retryable: false,
      message: "Effect replay blocked: an unresolved durable effect claim exists or could not be persisted. Human reconciliation is required before retrying; new invocation identities or approvals do not clear this guard.",
    };
  }

  // Exceptions, process death and cancellation leave the marker in place.
  const result = await execute();
  if (result.kind !== "success") {
    return {
      ...result, retryable: false, outcomeUnknown: true,
      hint: `${result.hint ?? ""} Effect claim retained; reconcile the effect with a human before retrying.`.trim(),
    };
  }
  try {
    unlinkSync(marker);
    syncDirectory(directory);
  } catch {
    // A known success remains success even if cleanup fails. A retained claim
    // conservatively blocks subsequent calls; never replace an applied effect
    // with a retryable persistence error.
  }
  return result;
}
