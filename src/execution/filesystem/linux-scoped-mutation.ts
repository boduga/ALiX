/**
 * Experimental Linux adapter for the fd-relative native prototype.
 * NOT registered with createScopedMutationService: policy binding, leases,
 * backend provenance, executable packaging, and audit remain unqualified.
 */
import { spawn } from "node:child_process";
import { isAbsolute, posix } from "node:path";
import type { ScopedMutationAuthority, ScopedMutationOperation, ScopedMutationOutcome, ScopedMutationService } from "./scoped-mutation.js";

function safeRelative(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

/**
 * Explicit opt-in test adapter; callers must supply a trusted, prebuilt helper.
 * Only supports exclusive create. Never treats user-provided authority fields
 * as evidence of an actual approval or lease.
 */
export class ExperimentalLinuxScopedMutationService implements ScopedMutationService {
  constructor(private readonly executable: string) {
    if (!isAbsolute(executable)) throw new Error("GE-04: helper path must be absolute");
  }

  async mutate(authority: ScopedMutationAuthority, operation: ScopedMutationOperation): Promise<ScopedMutationOutcome> {
    if (process.platform !== "linux") throw new Error("GE-04: Linux helper unavailable on this platform");
    if (operation.kind !== "create") throw new Error("GE-04: experimental backend supports exclusive create only");
    if (!isAbsolute(authority.workspaceRoot) || !safeRelative(authority.ownedScope) ||
        !safeRelative(operation.relativePath)) throw new Error("GE-04: invalid scoped path");
    // The prototype uses argv for content, so NUL and arbitrary binary content
    // cannot be faithfully represented. Reject rather than silently corrupt.
    if (operation.content.includes(0)) throw new Error("GE-04: binary payload unsupported by prototype");
    const content = Buffer.from(operation.content).toString("utf8");
    if (!Buffer.from(content, "utf8").equals(Buffer.from(operation.content))) {
      throw new Error("GE-04: prototype requires valid UTF-8 content");
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, [authority.workspaceRoot, posix.normalize(authority.ownedScope),
        operation.relativePath, content], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => { stderr = (stderr + data).slice(-2048); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`GE-04 native helper failed (${code}): ${stderr.trim()}`)));
    });
    return { kind: "created", changed: true };
  }
}
