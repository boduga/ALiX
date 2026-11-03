/** Experimental GE-04 coordination-owned lease authority; not production-wired. */
import { OwnershipRegistry } from "./ownership-registry.js";
import type { OwnershipRecord } from "./ownership-types.js";

const trustedGe04Ownership = new WeakSet<object>();

export type Ge04OwnershipAuthority = Readonly<{
  refresh(): Promise<void>;
  get(id: string): OwnershipRecord | undefined;
  withExclusiveLeaseFence<T>(leaseId: string, agentId: string, targetPath: string,
    action: () => Promise<T>): Promise<{ allowed: true; value: T } | { allowed: false }>;
}>;

/** Mint only from the authoritative durable registry, never from a callback. */
export function createGe04OwnershipAuthority(registry: OwnershipRegistry): Ge04OwnershipAuthority {
  if (!(registry instanceof OwnershipRegistry)) {
    throw new Error("GE-04: real ownership registry required");
  }
  const authority: Ge04OwnershipAuthority = {
    refresh: () => registry.refresh(),
    get: (id: string) => registry.get(id),
    withExclusiveLeaseFence: (leaseId, agentId, targetPath, action) =>
      registry.withExclusiveLeaseFence(leaseId, agentId, targetPath, action),
  };
  trustedGe04Ownership.add(authority);
  return Object.freeze(authority);
}

/** Structural copies and caller-authored lease objects cannot pass this gate. */
export function isTrustedGe04OwnershipAuthority(value: unknown): value is Ge04OwnershipAuthority {
  return typeof value === "object" && value !== null &&
    trustedGe04Ownership.has(value);
}
