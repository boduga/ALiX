import { listSessions, sessionInfo } from "../../session/resume.js";

export async function handler(args: string[]): Promise<number> {
  if (args[0] === "list") {
    const sessions = await listSessions(process.cwd());
    if (sessions.length === 0) {
      console.log("No sessions found.");
    } else {
      console.log(`${"ID".padEnd(38)} ${"Task".padEnd(50)} ${"Status".padEnd(14)} ${"Iters".padEnd(6)} Date`);
      console.log("-".repeat(120));
      for (const s of sessions) {
        const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "";
        console.log(`${s.sessionId.padEnd(38)} ${s.task.slice(0, 48).padEnd(50)} ${s.status.padEnd(14)} ${String(s.iterations).padEnd(6)} ${date}`);
      }
    }
    return 0;
  }

  if (args[0] === "show" && args[1]) {
    const info = await sessionInfo(process.cwd(), args[1]);
    if (!info) {
      console.error(`Session not found: ${args[1]}`);
      return 1;
    }
    console.log(`Session:    ${info.sessionId}`);
    console.log(`Task:       ${info.task}`);
    console.log(`Status:     ${info.status}`);
    console.log(`Iterations: ${info.iterations}`);
    console.log(`Repairs:    ${info.repairs}`);
    console.log(`File changes: ${info.fileChanges}`);
    console.log(`Shell cmds: ${info.shellCommands}`);
    console.log(`Created:    ${info.createdAt ? new Date(info.createdAt).toLocaleString() : "unknown"}`);
    console.log(`Updated:    ${info.updatedAt ? new Date(info.updatedAt).toLocaleString() : "unknown"}`);
    return 0;
  }

  if (args[0] === "show" && !args[1]) {
    console.error("Usage: alix session show <session-id>");
    return 1;
  }

  console.log("Usage: alix session [list|show <id>]");
  console.log("  list             - List all sessions (newest first)");
  console.log("  show <id>        - Show session details");
  return 0;
}
