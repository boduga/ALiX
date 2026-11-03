/** Experimental combined preflight; NOT a pidfd-bound authorization. */
import { assertGe04HelperIsolation } from "./ge04-helper-isolation.js";
import { inspectGe04HelperIntegrity, type Ge04HelperIntegrity } from "./ge04-helper-integrity.js";
import { inspectGe04WorkerCredentials } from "./ge04-worker-credentials.js";

export type Ge04VerifiedHelperGate = Ge04HelperIntegrity & Readonly<{
  workerPid: number;
  workerUid: number;
  workerGid: number;
  workerStartTimeTicks: string;
}>;

/**
 * Refuses caller-declared identity unless it agrees with an actual /proc
 * credential observation. Does not preserve process lifetime or lock the
 * helper inode; never use the result alone as mutation authorization.
 */
export async function assertGe04VerifiedHelperGate(config: Ge04VerifiedHelperGate): Promise<void> {
  if (!Number.isSafeInteger(config.workerGid) || config.workerGid < 0 ||
      !/^\d+$/.test(config.workerStartTimeTicks)) {
    throw new Error("GE-04: invalid expected worker kernel identity");
  }
  const observed = await inspectGe04WorkerCredentials(config.workerPid);
  if (observed.uid !== config.workerUid || observed.gid !== config.workerGid ||
      observed.startTimeTicks !== config.workerStartTimeTicks) {
    throw new Error("GE-04: worker kernel identity differs from declared identity");
  }
  await assertGe04HelperIsolation(config);
  await inspectGe04HelperIntegrity(config);
  // Detect ordinary worker exit or PID reuse during the preflight.
  const after = await inspectGe04WorkerCredentials(config.workerPid);
  if (after.uid !== observed.uid || after.gid !== observed.gid ||
      after.startTimeTicks !== observed.startTimeTicks) {
    throw new Error("GE-04: worker kernel identity changed during helper preflight");
  }
}
