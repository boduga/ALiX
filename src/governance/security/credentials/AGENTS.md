# DOX — Credential Store

## Purpose

The single protected secret-storage authority: store, resolve, and rotate
secrets behind a pluggable backend (plain file, OS keychain, passphrase-encrypted
file). Provider API keys and, per SRAP-1, versioned HMAC evidence keys live here.
No other subsystem owns a secret store.

## Ownership

- `credential-store.ts` — `CredentialStore` facade (`load`/`get`/`set`/`delete`/`list`/`has`/`count`/`maxEntries`/`backend`) over an injected `CredentialProvider`; `CredentialEntry` (id, provider namespace, keyLabel, encrypted, createdAt, updatedAt, backend, metadata) and `MAX_CREDENTIAL_ENTRIES = 256`. Composite lookup key is `provider:keyLabel` (case-insensitive).
- `credential-provider.ts` — backend interface + `isEncryptedBackend`.
- `plain-file-provider.ts` — default backend, `credential-store.json`, atomic temp+rename, mode `0o600`, symlink rejection.
- `keychain-provider.ts` — OS keychain backend via `@napi-rs/keyring` (macOS Keychain, Windows Credential Manager, Linux Secret Service); value in the keychain, metadata in `keychain-metadata.json`.
- `encrypted-file-provider.ts` — whole-store AES-256-GCM + Argon2id passphrase backend (`ALIX_CREDENTIAL_PASSPHRASE`); no silent fallback.
- `backend-selection.ts` — persisted `.backend` selector, keychain probe, fallback (keychain → plain-file; encrypted-file never falls back).
- `credential-reference.ts` — `cred://<provider>/<keyLabel>` scheme and `resolveValue`.
- `api-keys.ts` — provider API-key resolution over the store (store-only; environment variables are not consulted).
- `credential-migration.ts` — inline-config → store migration, replacing secrets with `cred://` refs.

## Local Contracts

- **Store-only resolution.** Secrets resolve from `~/.config/alix/config.json` `apiKeys` (literals or `cred://` refs) and this store; environment variables are never a fallback at any resolution site.
- **No secret values leave the store** except through `get` to trusted code. `list()` returns metadata only.
- **Atomic, restrictive writes.** Temp-file + rename; `0o600`; symlink-rejected.
- **`srap-evidence` namespace for versioned HMAC keys (SRAP-1).** Approval decision evidence uses the canonical serialization `credentialRef = hmac-sha256:v<N>:<base64url(HMAC(key_vN, credentialRecordId))>` — the key version is always an explicit `v<N>` marker, never a bare number. Keys live under provider namespace `srap-evidence` with the version encoded in the label (`hmac-key:v<N>`), because the store has no native per-entry version field; old versions coexist as ordinary entries.
  - Generation: new random 32-byte key as `hmac-key:v<N+1>`. Activation: decision code signs only with the current (highest) version; `generateKey`/`rotateKey` make the new version active immediately (no staged activation). Rotation: old versions stay resolvable while retained approval evidence may reference them.
  - **Retirement has two independent gates.** *Eligibility* (`retireEligibility`): the version is inactive and **no retained approval evidence references it** — retention is count-based (`maxTerminalRecords`), so the operator/approval subsystem supplies the retained-reference count; there is no wall-clock window. *Execution* (`retireKey`, an explicit operator action): eligibility never retires anything on its own, and retirement is never automatic. Unavailable active key = fail-closed (no decision committed). An old-version ref whose key is retired is reported unverifiable, never silently accepted and never an authority reversal.
  - Access: only trusted approval/audit code resolves `srap-evidence`. Key material is reachable **only** through the audited accessors `signCredentialRef`/`verifyCredentialRef`, whose `audit` sink is **mandatory** (not an optional callback) so every key access is reported. HMAC is computed in the owning subsystem, not the store.
- **Rejected:** a second secret/key authority; putting HMAC keys in the Inspector auth store (hash-only, owns no secret keys); reusing Ed25519 `ConfigSigner`/audit-checkpoint keypairs (signature keys, single current `keyId`, no overlap/retire lifecycle).

## Work Guidance

- Add a backend by implementing `CredentialProvider`; keep selection in `backend-selection.ts`.
- Namespaces are `provider` strings (`openai`, `anthropic`, `mcp`, `srap-evidence`); labels are free-form keys within a namespace.
- No per-namespace cap exists; the 256-entry cap is global.

## Verification

- Credential store tests under `tests/security/` (store CRUD, backend selection, reference resolution, migration).
- `tests/security/credentials/srap-evidence.test.ts` — SRAP HMAC key lifecycle: generate/increasing versions, rotation overlap, fail-closed signing, `valid`/`invalid`/`unverifiable` verification, retired-version unverifiability, refuses to retire the active key.

## Child DOX Index

None.
