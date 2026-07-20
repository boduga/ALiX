/**
 * Pure helper for /policy command. Takes the current config and args,
 * mutates config if switching modes, returns display lines.
 * No side effects — no I/O, no TUI output.
 */

export interface PolicyConfig {
  permissions?: { sessionMode?: string };
}

export function handlePolicyCommand(
  config: PolicyConfig,
  args: string,
): string[] {
  config.permissions ??= {};
  const currentMode = config.permissions.sessionMode || "bypass";
  const lines: string[] = [];
  const trimmed = args.trim().toLowerCase();

  if (trimmed === "bypass") {
    config.permissions.sessionMode = "bypass";
    lines.push("Session mode changed to: bypass");
    lines.push("  All tools allowed without approval.");
  } else if (trimmed === "ask") {
    config.permissions.sessionMode = "ask";
    lines.push("Session mode changed to: ask");
    lines.push("  Tool approval will be requested when policy requires it.");
  } else if (trimmed === "auto") {
    config.permissions.sessionMode = "auto";
    lines.push("Session mode changed to: auto");
    lines.push("  Previously approved tools allowed automatically.");
  } else if (trimmed === "" || trimmed === "show" || trimmed === "status") {
    const icon = currentMode === "bypass" ? "⚠" : currentMode === "ask" ? "✓" : "●";
    lines.push(`Policy session mode: ${icon} ${currentMode}`);
    lines.push("  Change with: /policy ask | /policy bypass | /policy auto");
    if (currentMode === "ask") {
      lines.push("  Commands requiring approval will prompt inline.");
    } else if (currentMode === "bypass") {
      lines.push("  All tool calls allowed — use with caution.");
    } else if (currentMode === "auto") {
      lines.push("  Previously approved capabilities auto-allowed.");
    }
  } else {
    lines.push("Unknown policy command. Usage:");
    lines.push("  /policy          — show current mode");
    lines.push("  /policy ask      — require approval for risky tools");
    lines.push("  /policy bypass   — allow all tools without approval");
    lines.push("  /policy auto     — auto-allow previously approved tools");
  }

  return lines;
}
