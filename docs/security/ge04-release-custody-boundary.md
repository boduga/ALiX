# GE-04 PR 5 — release-identity verification and custody contract

**Gate:** QUALIFICATION ONLY. The Linux supervisor is still inert, the
production `createScopedMutationService()` factory still returns the
unavailable service on every platform, and GE-04 SECURITY HOLD remains active.

This PR introduces an **offline, read-only** verifier at
`scripts/ge04-release-verify.mjs`. Its primary role is to identify bad
or missing release evidence before a future independently administered
supervisor can be considered. A successful cryptographic check is **not**
permission to run the supervisor, and the CLI intentionally exits **78** even
after successful verification.

## Cryptographic release format

The externally signed release payload is exactly this ordered JSON object,
encoded as UTF-8 and terminated by one newline:

```json
{"protocol":"ALIX_GE04_RELEASE_V1","sequence":14,"artifactSha256":"<lowercase 64-hex SHA-256 of runtime bytes>"}
```

The **64-byte Ed25519 signature** covers the exact canonical bytes, not
caller-supplied JSON serialization or a user-provided trust path. The
release metadata contains the three fields above plus one canonical base64
`signatureBase64`. The trusted metadata contains precisely
`protocol`, `publicKeyPem` and `minimumSequence`.

The verifier requires:

- Strict, canonical metadata (unexpected fields, reordered keys, duplicate
  keys, malformed encodings, invalid sequence and digest fail closed).
- An Ed25519 public verification key from the fixed administrator-controlled
  trust path; signature and pinned runtime SHA-256 must match.
- An administrator-provisioned monotonically advancing **minimum accepted
  release sequence**. Missing floor, downgrade below floor, or missing
  trusted file fails closed. The verifier **never** updates the floor, creates
  trust keys, signs anything or permits user-supplied alternative roots.
- A bounded regular-file read with `O_NOFOLLOW`, pinned file identity,
  ownership/permissions checks for the trust path, release manifest and
  executable artifact. Expected OS identity: root-owned, not group/world
  writable, and no symlink or hardlink aliases at the checked points.

Fixed paths (not CLI flags):

| Role | Root-owned path |
|---|---|
| Trust key and administrative minimum sequence | `/etc/alix/ge04/trust.json` |
| Signed release manifest | `/usr/local/lib/alix/ge04/release.json` |
| Supervisor artifact bytes | `/usr/local/lib/alix/ge04/supervisor.bin` |

These paths describe **future external provisioning requirements**.
This PR does not install files into them, create keys, or change owner/mode.

## Security limits and unsatisfied gates

1. **Independent custody not demonstrated.** The trusted files must be
   installed and advanced by a separate administrator/security principal.
   Merely running the verifier locally or creating root-owned files is not
   proof that a separate administrator controls the signing key and rollback
   floor. Private signing keys must not be present in the ALiX repository,
   a writable workspace, or the coordinator environment.
2. **Rollback floor is a minimum, not self-advancing.** Without an
   independently durable floor-advance operation, replaying an older release
   *above* the configured floor may still be possible. Signed manifests
   alone do not prevent that rollback.
3. **Filesystem provenance is not syscall-atomic.** `lstat`/open/`fstat`
   comparisons reduce static substitution risk but do not replace a
   supervisor-owned mount namespace, independently secured install tree, or
   descriptor-relative native final-effect authorization. A compromised root
   principal is outside this prototype's defenses.
4. **Runtime identity is not launch identity.** Validating file bytes does
   not attest the interpreter, dynamic loader, shared libraries, mount
   namespace, process lineage, environment, or the executable subsequently
   run. The returned `CRYPTOGRAPHIC_EVIDENCE_ONLY` marker is **not**
   a capability, authorization receipt, or kernel-effect attestation.
5. **No production invocation.** This verifier is a standalone script.
   It is not imported into the runtime, is not wired to the scoped mutation
   factory, and does not start a service. Even with valid evidence the
   CLI exits 78 and keeps the GE-04 SECURITY HOLD in effect.

## Regressions

`scripts/test-ge04-release-verify.mjs` exercises valid signatures,
rollback-denial, tampered bytes, key substitution, signature corruption,
canonical encoding, invalid manifest fields/sequence, oversize artifact
signed-field modification and a CLI that explicitly refuses user-controlled trust overrides.
`tests/security/ge04-release-custody.test.ts` runs these through the
normal cross-platform Node test discovery path.

**Next gates:** independent operator-led provisioning; protected,
rollback-resistant floor advancement; verified immutable runtime/loader
and process identity; and exact, expiry/revocation-aware authority at the
final kernel mutation boundary. These require separate reviews and tests.
Nothing here authorizes production GE-04 execution.
