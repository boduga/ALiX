/** Experimental Linux descriptor-bound helper launch. NOT production-qualified. */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { inspectGe04HelperIntegrity, type Ge04HelperIntegrity } from "./ge04-helper-integrity.js";

/**
 * Binds path resolution for exec to a pinned descriptor (fd 4) rather than
 * reopening the original executable pathname. Does NOT prevent writes to the
 * inode, prove kernel identity, or authenticate the receipt channel.
 */
export async function launchGe04PinnedHelper(
  config: Ge04HelperIntegrity,
  args: readonly string[],
  attemptId: string,
): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null; notification: string }>> {
  if (process.platform !== "linux" || !/^[0-9a-f-]{36}$/i.test(attemptId)) {
    throw new Error("GE-04: invalid pinned launch configuration");
  }
  // Preflight and descriptor open are separate; verify inode identity after
  // opening to detect a replacement in that interval, then use that fd for exec.
  const inspected = await inspectGe04HelperIntegrity(config);
  const executable = await open(config.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await executable.stat();
    if (!stat.isFile() || stat.dev !== inspected.device || stat.ino !== inspected.inode ||
        stat.uid !== config.expectedOwnerUid || (stat.mode & 0o022) !== 0) {
      throw new Error("GE-04: helper changed between inspection and descriptor pin");
    }
    return await new Promise((resolve, reject) => {
      const child = spawn("/proc/self/fd/4", [...args], {
        stdio: ["ignore", "ignore", "pipe", "pipe", executable.fd],
        env: { ...process.env, GE04_ATTEMPT_ID: attemptId, GE04_RECEIPT_FD: "3" },
      });
      let notification = "";
      child.stdio[3]?.on("data", (chunk: Buffer) => { notification = (notification + chunk.toString()).slice(0, 256); });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, notification }));
    });
  } finally { await executable.close(); }
}
