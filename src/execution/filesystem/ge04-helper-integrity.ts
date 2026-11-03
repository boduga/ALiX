/** Experimental executable integrity preflight, NOT an exec-time identity proof. */
import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type Ge04HelperIntegrity = Readonly<{
  executable: string;
  expectedSha256: string;
  expectedOwnerUid: number;
}>;

export async function inspectGe04HelperIntegrity(config: Ge04HelperIntegrity): Promise<Readonly<{
  sha256: string;
  device: number;
  inode: number;
}>> {
  if (process.platform !== "linux" || !isAbsolute(config.executable) ||
      !/^[a-f0-9]{64}$/.test(config.expectedSha256) ||
      !Number.isSafeInteger(config.expectedOwnerUid) || config.expectedOwnerUid < 0) {
    throw new Error("GE-04: invalid helper integrity configuration");
  }
  const handle = await open(config.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== config.expectedOwnerUid ||
        (before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0 || before.nlink !== 1) {
      throw new Error("GE-04: helper file ownership, mode or link count rejected");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(65536);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("GE-04: helper modified during integrity inspection");
    }
    const sha256 = digest.digest("hex");
    if (!timingSafeEqual(Buffer.from(sha256, "hex"), Buffer.from(config.expectedSha256, "hex"))) {
      throw new Error("GE-04: helper digest mismatch");
    }
    return { sha256, device: after.dev, inode: after.ino };
  } finally { await handle.close(); }
}
