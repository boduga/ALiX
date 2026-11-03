/**
 * Experimental supervised Linux worker launcher. This is NOT a pidfd-backed
 * lifecycle or permission to execute GE-04 mutations. No shell is involved.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { inspectGe04WorkerCredentials, type Ge04WorkerCredentials } from "./ge04-worker-credentials.js";

export type Ge04IsolatedWorker = Readonly<{
  child: ChildProcess;
  observed: Ge04WorkerCredentials;
}>;

export async function spawnGe04IsolatedWorker(
  executable: string,
  args: readonly string[],
  workerUid: number,
  workerGid: number,
): Promise<Ge04IsolatedWorker> {
  if (process.platform !== "linux" || !process.getuid || !process.getgid ||
      !Number.isSafeInteger(workerUid) || workerUid < 1 ||
      !Number.isSafeInteger(workerGid) || workerGid < 1 ||
      workerUid === process.getuid() || !executable.startsWith("/")) {
    throw new Error("GE-04: distinct-UID Linux worker and absolute executable required");
  }
  // Unprivileged coordinators cannot reliably switch to a distinct UID.
  // Fail closed rather than silently spawning a same-UID worker.
  if (process.geteuid?.() !== 0) {
    throw new Error("GE-04: distinct-UID worker launch requires privileged supervisor");
  }
  const child = spawn(executable, [...args], {
    uid: workerUid, gid: workerGid, shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    if (!child.pid) throw new Error("GE-04: worker spawn failed");
    const observed = await inspectGe04WorkerCredentials(child.pid);
    if (observed.uid !== workerUid || observed.gid !== workerGid) {
      throw new Error("GE-04: worker credentials do not match requested identity");
    }
    return { child, observed };
  } catch (error) {
    child.kill("SIGKILL");
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await Promise.race([once(child, "exit"), once(child, "error")]).catch(() => {});
    }
    throw error;
  }
}
