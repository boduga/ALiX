/**
 * GE-04 governed filesystem mutation seam.
 *
 * Deliberately fail-closed until a reviewed native backend can bind policy
 * authority to kernel-enforced, descriptor-relative filesystem operations.
 * This module is not yet wired into the existing file or patch routers.
 */
export type ScopedMutationOperation =
  | { readonly kind: "create"; readonly relativePath: string; readonly content: Uint8Array }
  | { readonly kind: "replace"; readonly relativePath: string; readonly content: Uint8Array; readonly expectedSha256: string }
  | { readonly kind: "delete"; readonly relativePath: string; readonly expectedSha256?: string };

export interface ScopedMutationAuthority {
  readonly workspaceRoot: string;
  readonly ownedScope: string;
  readonly workerId: string;
  readonly policyRevision: string;
  readonly leaseId: string;
}

export type ScopedMutationOutcome =
  | { readonly kind: "created" | "replaced" | "deleted"; readonly changed: true }
  | { readonly kind: "identical"; readonly changed: false };

export interface ScopedMutationService {
  mutate(authority: ScopedMutationAuthority, operation: ScopedMutationOperation): Promise<ScopedMutationOutcome>;
}

/** Never silently substitute path-based Node fs calls for a missing backend. */
export class UnavailableScopedMutationService implements ScopedMutationService {
  async mutate(_authority: ScopedMutationAuthority, _operation: ScopedMutationOperation): Promise<never> {
    throw new Error("GE-04: qualified scoped mutation backend unavailable (fail closed)");
  }
}

/**
 * Backend selection is intentionally explicit. No backend is qualified yet;
 * even Linux must fail closed until native implementation and review land.
 */
export function createScopedMutationService(_platform: NodeJS.Platform = process.platform): ScopedMutationService {
  return new UnavailableScopedMutationService();
}
