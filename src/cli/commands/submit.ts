import { connect } from "node:net";

export async function handler(args: string[]): Promise<number> {
  const task = args.join(" ").replace(/^["']|["']$/g, "");
  if (!task) {
    console.error('Usage: alix submit "<task>"');
    return 1;
  }

  const cwd = process.cwd();
  const { DaemonManager } = await import("../../daemon/daemon-manager.js");
  const mgr = new DaemonManager(cwd);
  const running = await mgr.isRunning();
  if (!running) {
    console.error("Daemon is not running. Start it with: alix daemon start");
    return 1;
  }

  const socketPath = mgr.socketPath();
  if (!socketPath) {
    console.error("No socket path found.");
    return 1;
  }

  return new Promise<number>((resolve) => {
    const payload = JSON.stringify({ command: "run", task, cwd }) + "\n";
    const client = connect(socketPath, () => {
      client.write(payload);
    });

    // Idle timeout: reset on every data event so only fires when
    // daemon goes silent (e.g. socket stuck open, daemon wedged).
    // A legitimate long-running task keeps emitting and never trips
    // the timer. The previous implementation checked total runtime,
    // which incorrectly aborted tasks that took longer than 30s.
    const IDLE_TIMEOUT_MS = 30_000;
    let idleTimer: NodeJS.Timeout | null = null;
    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (process.exitCode === undefined) {
          console.error(`Daemon did not respond within ${IDLE_TIMEOUT_MS / 1000}s; giving up.`);
          resolve(1);
        }
      }, IDLE_TIMEOUT_MS);
    };
    armIdleTimer();

    client.on("data", (data: Buffer) => {
      armIdleTimer();
      for (const line of data.toString().trim().split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "task.created") console.log(`Task created: ${msg.taskId}`);
          else if (msg.type === "session.started") console.log(`Session: ${msg.sessionId}`);
          else if (msg.type === "task.accepted") console.log(`Task accepted: ${msg.task}`);
          else if (msg.type === "queue.position") console.log(`Queue position: ${msg.position}`);
          else if (msg.type === "tool.started") console.log(`  → ${msg.toolName || "tool"} started`);
          else if (msg.type === "tool.completed") console.log(`  ✓ ${msg.toolName || "tool"} completed${msg.durationMs ? ` (${msg.durationMs}ms)` : ""}`);
          else if (msg.type === "tool.failed") console.log(`  ✗ ${msg.toolName || "tool"} failed${msg.error ? `: ${msg.error.slice(0, 60)}` : ""}`);
          else if (msg.type === "task.completed") { console.log(`\nTask completed: ${msg.status}`); resolve(0); client.destroy(); }
          else if (msg.type === "task.failed") { console.error(`\nTask failed: ${msg.error}`); process.exitCode = 1; resolve(1); client.destroy(); }
          else if (msg.type === "session.ended") { resolve(0); client.destroy(); }
        } catch {
          console.log(line);
        }
      }
    });

    client.on("error", (err: Error) => {
      if (process.exitCode === undefined) {
        console.error(`Connection error: ${err.message}`);
        resolve(1);
      }
    });

    client.on("close", () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (process.exitCode === undefined) resolve(0);
    });
  });
}
