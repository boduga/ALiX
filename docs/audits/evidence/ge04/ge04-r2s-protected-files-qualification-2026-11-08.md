# GE-04-R2S — Protected-file loading qualification (2026-11-08)

**Status:** Qualification implementation in a separate review branch; GE-04 SECURITY HOLD ACTIVE.
**Parent:** R2S mTLS review [#1073](https://github.com/boduga/ALiX/pull/1073).
**Contracts:** [ADR-0018](../../../architecture/adrs/ADR-0018-independent-trust-service.md) and [Trust Service Contract](../../../security/ge04-trust-service-contract.md).

## Implementation

- `scripts/ge04-r2s-protected-files.py` implements Linux-only descriptor-relative, `O_NOFOLLOW`/directory-FD traversal from `/`, with owner and write-permission checks at each pinned ancestor and at the leaf. The regular file must have exactly one hardlink; size limits and bounded reads are enforced. Noncanonical `..`/`.` paths are rejected.
- Opt-in `serve-mtls` reads the identity manifest from a pinned descriptor and passes `/proc/self/fd/N` pinned file references to OpenSSL while cert/key/CA FDs remain open. No fallback to pathname reopening if this Linux-only mechanism is unavailable. The existing legacy loopback `serve` is not changed.
- Opt-in `serve-mtls` now loads the witness signing key from protected descriptor-relative storage before serving. Private keys (witness and TLS) require mode `0600`, or `0640` when the group matches the service's effective GID; public certificates and the role manifest may be read-only for others. The old R2Q qualification `serve` remains unchanged, including its unqualified path-check/reopen limitations. **The signing key remains process-readable and inside the same guest failure domain.** This work does not establish HSM custody or prevent key theft after service compromise.
- Tests exercise symlink parent/leaf, hardlinks, world/group write permissions, oversized files, unsafe ancestry, noncanonical paths and replacement after a descriptor is opened. Isolated mTLS test CA fixtures use an explicitly mocked file opener because user-owned temporary directories cannot meet the production root-owned ancestry policy. The real opener is separately exercised with its actual kernel flags and leaf metadata validation.

## Scope and limitations

**This is hardening, not independent trust.** A root-controlled VM can still snapshot/restore its local key and SQLite head. No independent monotonic checkpoint anchor, operator-enrolled CA, signer HSM, revocation/rotation, production verifier nonce custody, attested journal, deployed public listener or privileged worker admission is installed.

Root directory ownership alone is not a defense against a compromised root/admin principal. Descriptor pinning reduces path substitution but does not certify mount provenance, immutable boot identity, key origin, kernel isolation, or independent authority. The current HTTP handler remains subject to request-parser and concurrency review.

The production service must fail closed if protected paths or descriptor APIs are unavailable. All provisioned files and directory ancestry need independently administered trusted ownership and restrictive permissions before the opt-in mode can start. No automatic privilege/authorization path is introduced.

## Acceptance

Qualification requires tests on a real protected root-owned provisioning tree, including race injection while OpenSSL loads keys, then cross-host snapshot, compromised signer and revoked-identity fault tests. This evidence does **not** satisfy those deployment gates.

**GE-04 SECURITY HOLD remains active. No deploy, no merge authorization.**
