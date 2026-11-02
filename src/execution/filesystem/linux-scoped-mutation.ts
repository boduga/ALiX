/**
 * Experimental Linux adapter for the fd-relative native prototype.
 * NOT registered with createScopedMutationService: backend provenance,
 * executable packaging, cross-platform backends and independent review remain
 * unqualified. Production service selection stays fail-closed.
 */
import { spawn } from "node:child_process";
import { isAbsolute, posix } from "node:path";
import type { ScopedMutationAuthority, ScopedMutationOperation, ScopedMutationOutcome, ScopedMutationService } from "./scoped-mutation.js";
import {
  isSafeScopedRelativePath,
  isTrustedScopedMutationVerifier,
  type ScopedMutationAuthorizationVerifier,
} from "./scoped-mutation-authorization.js";

/**
 * Explicit opt-in test adapter; callers must supply a trusted, prebuilt helper
 * AND a verifier minted by `createScopedMutationAuthorizationVerifier`.
 *
 * A plain callback is rejected at construction: the previous iteration accepted
 * any `async () => true`, which is a parameter rather than a guard. There is no
 * supported way to run a scoped write without composing the real approval,
 * policy and ownership authorities.
 */
export class ExperimentalLinuxScopedMutationService implements ScopedMutationService {
  constructor(
    private readonly executable: string,
    private readonly verifyAuthorization: ScopedMutationAuthorizationVerifier,
  ) {
    if (!isAbsolute(executable)) throw new Error("GE-04: helper path must be absolute");
    if (!isTrustedScopedMutationVerifier(verifyAuthorization)) {
      throw new Error("GE-04: authorization verifier must be composed from durable authorities");
    }
  }

  async mutate(authority: ScopedMutationAuthority, operation: ScopedMutationOperation): Promise<ScopedMutationOutcome> {
    if (process.platform !== "linux") throw new Error("GE-04: Linux helper unavailable on this platform");
    if (operation.kind !== "create") throw new Error("GE-04: experimental backend supports exclusive create only");
    if (!isAbsolute(authority.workspaceRoot) || !isSafeScopedRelativePath(authority.ownedScope) ||
        !isSafeScopedRelativePath(operation.relativePath)) throw new Error("GE-04: invalid scoped path");
    // The prototype uses argv for content, so NUL and arbitrary binary content
    // cannot be faithfully represented. Reject rather than silently corrupt.
    if (operation.content.includes(0)) throw new Error("GE-04: binary payload unsupported by prototype");
    const content = Buffer.from(operation.content).toString("utf8");
    if (!Buffer.from(content, "utf8").equals(Buffer.from(operation.content))) {
      throw new Error("GE-04: prototype requires valid UTF-8 content");
    }
    // Fail closed when the authority metadata is absent: the verifier re-derives
    // every one of these facts from the stores, so a missing value is a caller
    // bug, not an implicit grant. Never treat the fields as self-authenticating.
    if (!authority.workerId || !authority.policyRevision || !authority.leaseId || !authority.approvalId) {
      throw new Error("GE-04: authoritative mutation verification required");
    }
    const grant = await this.verifyAuthorization(authority, operation);
    if (!grant) throw new Error("GE-04: authoritative mutation verification required");

    try {
      // Recheck immediately before dispatch: a lease or policy may have
      // changed while the single-use approval was being consumed. This is
      // defense in depth only; it does NOT close the spawn-to-create race.
      if (!(await grant.revalidate())) {
        throw new Error("GE-04: authority lapsed before native helper dispatch");
      }
      // Keep the existing ownership revocation/release lock held until the
      // helper finishes. This closes the explicit-revocation race for callers
      // using OwnershipRegistry, but NOT policy invalidation or lease expiry.
      const fenced = await grant.withLeaseFence(() => this.invokeHelper(authority, operation, content));
      if (!fenced.allowed) throw new Error("GE-04: lease fence denied native helper dispatch");
    } catch (error) {
      await grant.settle("failed");
      throw error;
    }

    // The helper has already written. Re-check the authorities that could have
    // lapsed while it ran: a lease revoked or a policy revision changed between
    // verification and completion means the write is NOT a trustworthy success.
    // It cannot be undone from here, so report it as unverified rather than
    // claiming `changed: true` under authority that no longer held.
    const stillAuthorized = await grant.revalidate();
    if (!stillAuthorized) {
      await grant.settle("succeeded");
      return { kind: "unverified", changed: true, reason: "authority lapsed during scoped mutation" };
    }
    await grant.settle("succeeded");
    return { kind: "created", changed: true };
  }

  private async invokeHelper(
    authority: ScopedMutationAuthority,
    operation: Extract<ScopedMutationOperation, { kind: "create" }>,
    content: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, [authority.workspaceRoot, posix.normalize(authority.ownedScope),
        operation.relativePath, content], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => { stderr = (stderr + data).slice(-2048); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`GE-04 native helper failed (${code}): ${stderr.trim()}`)));
    });
  }
}

// Compatibility re-export: the lease predicate has ONE implementation, in the
// authorization module. Kept here so existing imports do not fork it.
export { createLiveScopedLeaseVerifier } from "./scoped-mutation-authorization.js";
