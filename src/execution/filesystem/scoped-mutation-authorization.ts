/**
 * scoped-mutation-authorization.ts — trusted authorization composition for the
 * experimental GE-04 mutation adapter.
 *
 * WHY THIS MODULE EXISTS
 *
 * The first iteration of `ExperimentalLinuxScopedMutationService` accepted a
 * caller-supplied `async () => true`. That is not a guard: it is a parameter.
 * A guard has to be composed from the authorities ALiX already has, and it must
 * be impossible for a caller to substitute a permissive stand-in.
 *
 * So the adapter now accepts ONLY a verifier minted here (`createScopedMutation
 * AuthorizationVerifier`), identified by a module-private brand symbol. The
 * brand is not exported, so no other module can fabricate a trusted verifier;
 * the only way to obtain one is to hand this factory the real durable stores.
 * This closes the documented "a test caller can inject a permissive callback"
 * fail-open.
 *
 * WHAT IT COMPOSES — AND WHAT IT DELIBERATELY DOES NOT
 *
 *  - Policy authority: the same deterministic revision fingerprint
 *    (`computePolicyRevision`) the coordination scheduler uses to invalidate an
 *    approval whose policy has changed. Equal revision means "the policy that
 *    issued this grant is still the policy in force". No second rule set is
 *    invented, and `PolicyGate` is NOT re-invoked here: `evaluate*` mints and
 *    reuses approvals as a side effect, which must never happen at a final
 *    boundary immediately before a native write.
 *  - Approval authority: `ApprovalStore.consumeApproved` — the one atomic
 *    single-use claim in the repository. The record must be approved, unexpired
 *    by the shared `approvalExpiryState` classifier, bound to this worker, this
 *    policy revision, and this exact invocation, and the claim must actually be
 *    won. A record that has already been consumed can never be re-used.
 *  - Ownership authority: `OwnershipRegistry` through the existing live-lease
 *    predicate and the shared `scopeContains` matcher.
 *
 * The grant returned to the adapter carries `revalidate()` and `settle()`:
 *  - `revalidate()` re-checks the lease and the policy revision AFTER the helper
 *    has run. The verification-to-spawn interval is still a TOCTOU window (Node
 *    cannot hold the kernel's lease check across a process boundary), but a
 *    grant that lapsed mid-flight turns the result into a fail-closed
 *    "unverified" outcome instead of a success claim.
 *  - `settle()` reports the terminal execution outcome through the existing
 *    `recordExecutionOutcome` seam, so a consumed claim never silently stays
 *    `pending` (which a later replay would classify `unverified`).
 *
 * NOT QUALIFIED FOR PRODUCTION. The native helper, executable packaging,
 * cross-platform backends and independent review are all still outstanding.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isTrustedGe04ApprovalAuthority, type Ge04ApprovalAuthority } from "../../governance/approvals/ge04-approval-authority.js";
import { isTrustedGe04OwnershipAuthority, type Ge04OwnershipAuthority } from "../../coordination/ownership/ge04-ownership-authority.js";
import { computePolicyRevision } from "../../governance/policy/policy-revision.js";
import {
  approvalExpiryState,
  computeInvocationFingerprint,
  type InvocationIdentity,
} from "../../governance/approvals/approval-binding.js";
import { scopeContains } from "../../coordination/ownership/path-scope.js";
import type { AlixConfig } from "../../operations/config/schema.js";
import type {
  ScopedMutationAuthority,
  ScopedMutationOperation,
} from "./scoped-mutation.js";

/** Capability/tool identity the scoped create is authorized under. */
const SCOPED_CREATE_CAPABILITY = "file.create";

/**
 * A workspace-relative path with no traversal, no absolute form, and no
 * backslash. Shared by the adapter and both verifiers so the three cannot
 * disagree about what a scoped path is.
 */
export function isSafeScopedRelativePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

/**
 * Live lease predicate backed by the existing durable OwnershipRegistry.
 *
 * This is ONE prerequisite for authorization, not a policy decision. It is
 * intentionally NOT accepted by the adapter as an authorization verifier — an
 * ownership check says nothing about approval or policy revision.
 */
export type ScopedMutationLeaseVerifier = (
  authority: Readonly<ScopedMutationAuthority>,
  operation: Readonly<ScopedMutationOperation>,
) => Promise<boolean>;

export function createLiveScopedLeaseVerifier(registry: Ge04OwnershipAuthority): ScopedMutationLeaseVerifier {
  if (!isTrustedGe04OwnershipAuthority(registry)) {
    throw new Error("GE-04: live lease verification requires trusted ownership authority");
  }
  return async (authority, operation) => {
    if (!isAbsolute(authority.workspaceRoot) || !isSafeScopedRelativePath(authority.ownedScope) ||
        !isSafeScopedRelativePath(operation.relativePath) || !authority.workerId || !authority.leaseId) return false;
    await registry.refresh(); // fails closed if durable state is unavailable
    const lease = registry.get(authority.leaseId);
    if (!lease || lease.status !== "active" || lease.mode !== "exclusive-write" ||
        lease.agentId !== authority.workerId ||
        !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.now()) return false;
    const ownedRoot = resolve(authority.workspaceRoot, authority.ownedScope);
    const target = join(ownedRoot, operation.relativePath);
    if (!scopeContains(lease.scope, ownedRoot) || !scopeContains(lease.scope, target)) return false;
    // Scope matching is lexical. Independently reject existing symlinked
    // components before consuming the one-shot approval. The native helper
    // remains responsible for atomic fd-relative containment at mutation time.
    try {
      if (realpathSync(authority.workspaceRoot) !== resolve(authority.workspaceRoot)) return false;
      if (realpathSync(ownedRoot) !== ownedRoot) return false;
      let parent = dirname(target);
      while (parent !== ownedRoot) {
        try {
          if (realpathSync(parent) !== parent) return false;
          break; // Existing ancestor is canonical; absent descendants are helper-checked.
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
          const next = dirname(parent);
          if (next === parent || !scopeContains({ kind: "path", root: ownedRoot, recursive: true }, next)) return false;
          parent = next;
        }
      }
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * The exact invocation a scoped create approval must be bound to.
 *
 * Both the host that requests the approval and the verifier that claims it call
 * this one builder, exactly as the tool path uses `computeInvocationFingerprint`,
 * so a bound approval can never drift to different bytes or a different target.
 */
export function computeScopedMutationInvocation(
  authority: Readonly<ScopedMutationAuthority>,
  operation: Readonly<ScopedMutationOperation>,
): InvocationIdentity {
  const content = operation.kind === "create" ? operation.content : new Uint8Array();
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  const argsHash = createHash("sha256").update(JSON.stringify({
    contentSha256,
    ownedScope: authority.ownedScope,
    relativePath: operation.relativePath,
  })).digest("hex");
  return {
    capability: SCOPED_CREATE_CAPABILITY,
    toolName: SCOPED_CREATE_CAPABILITY,
    workspace: resolve(authority.workspaceRoot),
    argsHash,
    agentId: authority.workerId,
  };
}

/**
 * Authorization granted for exactly one mutation. Nothing in the adapter may
 * perform the write without one of these.
 */
export type ScopedMutationAuthorizationGrant = {
  readonly approvalId: string;
  readonly leaseId: string;
  /** Re-check policy revision + lease validity AFTER the helper has run. */
  revalidate(): Promise<boolean>;
  /** Hold the durable ownership revocation lock across an experimental action. */
  withLeaseFence<T>(action: () => Promise<T>): Promise<{ allowed: true; value: T } | { allowed: false }>;
  /** Report the terminal outcome through the existing approval seam. */
  settle(outcome: "succeeded" | "failed" | "cancelled"): Promise<void>;
};

export type ScopedMutationAuthorizationVerifier = (
  authority: Readonly<ScopedMutationAuthority>,
  operation: Readonly<ScopedMutationOperation>,
) => Promise<ScopedMutationAuthorizationGrant | null>;

/**
 * Module-private brand. Not exported: obtaining a trusted verifier requires
 * going through `createScopedMutationAuthorizationVerifier`.
 */
const TRUSTED_AUTHORIZATION = Symbol("ge04.scoped-mutation.trusted-authorization");

export function isTrustedScopedMutationVerifier(
  value: unknown,
): value is ScopedMutationAuthorizationVerifier {
  return typeof value === "function" &&
    (value as unknown as Record<symbol, unknown>)[TRUSTED_AUTHORIZATION] === true;
}

function brand(
  verifier: ScopedMutationAuthorizationVerifier,
): ScopedMutationAuthorizationVerifier {
  Object.defineProperty(verifier, TRUSTED_AUTHORIZATION, { value: true, enumerable: false });
  return verifier;
}

export type ScopedMutationAuthorizationDeps = {
  /** The policy configuration in force; its revision is recomputed per check. */
  readonly config: AlixConfig;
  /** The one durable approval authority. Consumed atomically, never re-issued. */
  readonly approvalStore: Ge04ApprovalAuthority;
  /** The one durable ownership authority. */
  readonly registry: Ge04OwnershipAuthority;
  /** Host-attributed worker attempt, when the caller has one. */
  readonly workerAttempt?: number;
  /** Deterministic clock for expiry tests. */
  readonly now?: () => Date;
};

/**
 * Compose the trusted verifier from the existing authorities.
 *
 * Fail-closed ordering matters: the cheap, side-effect-free checks run FIRST so
 * a forged policy revision or a dead lease can never spend a real approval.
 * Only a mutation that is currently authorized reaches `consumeApproved`.
 */
export function createScopedMutationAuthorizationVerifier(
  deps: ScopedMutationAuthorizationDeps,
): ScopedMutationAuthorizationVerifier {
  // Reject plain-object substitutes at the trust-composition boundary. This is
  // defense in depth, not proof that a same-process caller is trustworthy.
  if (!isTrustedGe04ApprovalAuthority(deps.approvalStore) || !isTrustedGe04OwnershipAuthority(deps.registry)) {
    throw new Error("GE-04: authorization requires real approval and ownership store instances");
  }
  const leaseVerifier = createLiveScopedLeaseVerifier(deps.registry);
  const clock = deps.now ?? (() => new Date());
  const currentPolicyRevision = (): string => computePolicyRevision(deps.config);

  const verifier: ScopedMutationAuthorizationVerifier = async (authority, operation) => {
    // Only the exclusive-create prototype is supported; anything else must not
    // be authorized by a create-shaped grant.
    if (operation.kind !== "create") return null;
    if (!isAbsolute(authority.workspaceRoot) ||
        !isSafeScopedRelativePath(authority.ownedScope) ||
        !isSafeScopedRelativePath(operation.relativePath)) return null;
    if (!authority.workerId || !authority.policyRevision || !authority.leaseId ||
        !authority.approvalId) return null;

    // (1) Policy revision: the approval is only as current as the policy that
    // issued it (the coordination scheduler's rule, not a second one).
    if (authority.policyRevision !== currentPolicyRevision()) return null;

    // (2) Live exclusive-write lease covering the owned root AND the target.
    if (!(await leaseVerifier(authority, operation))) return null;

    // (3) Single-use approval. Refresh from the ledger first so a decision made
    // by another process is visible; a load failure fails closed.
    try {
      await deps.approvalStore.load();
    } catch {
      return null;
    }
    const record = deps.approvalStore.get(authority.approvalId);
    if (!record || !record.bindingKey) return null;
    if (record.status !== "approved") return null;
    if (approvalExpiryState(record.expiresAt, clock()) !== "valid") return null;
    if (record.policyRevision !== authority.policyRevision) return null;
    if (record.workerId !== authority.workerId) return null;
    if (record.workerAttempt !== undefined && deps.workerAttempt !== undefined &&
        record.workerAttempt !== deps.workerAttempt) return null;

    const invocation = computeScopedMutationInvocation(authority, operation);
    if (record.invocationFingerprint !== computeInvocationFingerprint(invocation)) return null;

    const claim = await deps.approvalStore.consumeApproved(
      record.id,
      record.bindingKey,
      {
        workerId: authority.workerId,
        ...(record.workerAttempt !== undefined ? { workerAttempt: record.workerAttempt } : {}),
        ...(deps.now ? { now: clock() } : {}),
      },
      invocation,
    );
    if (!claim.consumed) return null;

    let settled = false;
    return {
      approvalId: record.id,
      leaseId: authority.leaseId,
      async revalidate(): Promise<boolean> {
        if (authority.policyRevision !== currentPolicyRevision()) return false;
        return leaseVerifier(authority, operation);
      },
      async withLeaseFence<T>(action: () => Promise<T>): Promise<{ allowed: true; value: T } | { allowed: false }> {
        if (authority.policyRevision !== currentPolicyRevision()) return { allowed: false };
        const target = join(resolve(authority.workspaceRoot, authority.ownedScope), operation.relativePath);
        return deps.registry.withExclusiveLeaseFence(authority.leaseId, authority.workerId, target, action);
      },
      async settle(outcome): Promise<void> {
        if (settled) return;
        settled = true;
        try {
          await deps.approvalStore.recordExecutionOutcome(record.id, outcome);
        } catch {
          // The durable claim stays `pending`; a later replay classifies it
          // `unverified`. Never rethrow into the mutation result.
        }
      },
    };
  };

  return brand(verifier);
}
