# Credential Store

## Overview
The single protected secret-storage authority for ALiX. Provider API keys and versioned SRAP evidence HMAC keys live behind a pluggable backend: a plain-text file (default), the OS keychain, or a passphrase-encrypted file. The facade enforces a global entry cap and exposes metadata-only listing; backend choice is persisted in a selector file and keychain failures fall back to the plain-file store, while encrypted-file failures never do.

## Interface
- `CredentialStore` — facade over an injected provider: `load`, sync `get`/`list`/`has`/`count`/`maxEntries`/`backend`, async `set`/`delete` `[credential-store.ts:CredentialStore]`
- `CredentialEntry`, `StoredCredential`, `StoreSchema` — on-disk and in-memory shapes `[credential-store.ts:CredentialEntry]`
- `lookupKey`, `MAX_CREDENTIAL_ENTRIES = 256` — case-insensitive `provider:keyLabel` composite key and global cap `[credential-store.ts:lookupKey]`
- `CredentialProvider` — backend contract (async `load`/`set`/`delete`; sync `get`/`list`/`serialize`) `[credential-provider.ts:CredentialProvider]`
- `isEncryptedBackend` — true for any backend other than `"plain-file"` `[credential-provider.ts:isEncryptedBackend]`
- `PlainFileProvider` — default backend, `STORE_FILENAME = "credential-store.json"`, `STORE_VERSION = 1`, `emptyStore()` `[plain-file-provider.ts:PlainFileProvider]`
- `MemoryCredentialProvider` — shared CRUD implementation for subclasses; `set`/`delete` throw until loaded `[memory-credential-provider.ts:MemoryCredentialProvider]`
- `KeychainProvider`, `KeychainProviderOptions`, `KEYCHAIN_SERVICE = "alix"`, `KEYCHAIN_PROBE_ENTRY` — OS-keychain backend with JSON metadata sidecar `[keychain-provider.ts:KeychainProvider]`
- `resolveKeychainEntryFactory`, `probeKeychainWith` — lazy native binding resolution and throwaway SET+DELETE probe `[keychain-provider.ts:resolveKeychainEntryFactory]`
- `EncryptedFileProvider`, `EncryptedFileProviderOptions` — AES-256-GCM + Argon2id passphrase backend `[encrypted-file-provider.ts:EncryptedFileProvider]`
- `CredentialBackend`, `CREDENTIAL_PASSPHRASE_ENV = "ALIX_CREDENTIAL_PASSPHRASE"`, `resolveCredentialPassphrase` — backend union and passphrase precedence `[backend-selection.ts:CredentialBackend]`
- `credentialsDir`, `plainStorePath`, `scrubPlainFileStore`, `readStoredBackend`, `writeStoredBackend` — storage paths and selector persistence `[backend-selection.ts:readStoredBackend]`
- `chooseBackend`, `probeKeychain`, `createCredentialStoreForBackend`, `loadCredentialStoreWithKeychainFallback` — selection and construction seams `[backend-selection.ts:chooseBackend]`
- `CREDENTIAL_SCHEME = "cred://"`, `isCredentialReference`, `makeCredentialReference`, `parseCredentialReference`, `resolveCredential`, `resolveValue` — reference scheme parsing and resolution `[credential-reference.ts:CREDENTIAL_SCHEME]`
- `getSavedApiKey`, `resolveApiKeyReference`, `setApiKey`, `deleteApiKey`, `getApiKey` — store-only provider API-key resolution and mutation `[api-keys.ts:getApiKey]`
- `SRAP_EVIDENCE_PROVIDER`, `SRAP_KEY_LABEL_PREFIX`, `SRAP_HMAC_ALGORITHM`, `SrapKeyUnavailableError`, `keyLabel`, `parseKeyLabel`, `listKeyVersions`, `activeKeyVersion`, `generateKey`, `rotateKey`, `retireEligibility`, `retireKey`, `signCredentialRef`, `parseCredentialRef`, `verifyCredentialRef` — SRAP-1 HMAC key lifecycle and evidence refs `[srap-evidence.ts:signCredentialRef]`
- `migrateCredentials`, `MigrationResult`, `MigrationFileResult`, `MigrationOptions` — inline-config to store migration replacing secrets with `cred://` refs `[credential-migration.ts:migrateCredentials]`

## Invariants
- The store is the only secret authority; provider API keys resolve from `~/.config/alix/config.json` `apiKeys` and the store, never from environment variables `[api-keys.ts:getSavedApiKey]`
- Lookup keys are lowercased `provider:keyLabel` composites, so provider and label matching is case-insensitive `[credential-store.ts:lookupKey]`
- The global cap is `MAX_CREDENTIAL_ENTRIES = 256`; no per-namespace cap exists `[credential-store.ts:MAX_CREDENTIAL_ENTRIES]`
- `list()` exposes entry metadata only; key material is reachable only through `get` `[credential-store.ts:CredentialStore]`
- Plain-file writes are atomic (temp file + rename), directory mode `0o700` and file mode `0o600`, and symlinks are rejected via `lstat` `[plain-file-provider.ts:PlainFileProvider]`
- Encrypted-file decryption requires the passphrase; a wrong passphrase, corrupt envelope, or unsupported schema throws and never falls back to plain text `[encrypted-file-provider.ts:EncryptedFileProvider]`
- A `cred://` reference must match `^cred:\/\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_:.-]+)$`; malformed or absent references resolve to `null` while `resolveValue` throws on a missing entry or recursive reference `[credential-reference.ts:resolveCredential]`
- The persisted `.backend` selector wins over probing; an existing plain store is kept as plain-file with no silent migration; fresh installs probe the keychain and otherwise choose plain-file `[backend-selection.ts:chooseBackend]`
- Keychain load failure falls back to plain-file, but an encrypted-file backend never falls back; config load supplies no interactive passphrase prompt function `[backend-selection.ts:loadCredentialStoreWithKeychainFallback]`
- `getApiKey` returns the saved key, then `""` for keyless providers, then `undefined`, and never throws `[api-keys.ts:getApiKey]`
- SRAP keys are 32-byte HMAC-SHA256 keys stored under namespace `srap-evidence` with the version in the label (`hmac-key:v<N>`); the active key is the highest version and `generateKey`/`rotateKey` activate a new version immediately `[srap-evidence.ts:activeKeyVersion]`
- `retireKey` refuses the active key and versions still referenced by retained evidence; `retireEligibility` reports `absent`, `active`, or `retained-references` `[srap-evidence.ts:retireEligibility]`
- `signCredentialRef` awaits its mandatory audit sink before returning the ref and fails closed when no active or readable key exists; `verifyCredentialRef` audits before the verdict, returns `unverifiable` for a missing key, and compares MACs with `timingSafeEqual` after a length check `[srap-evidence.ts:signCredentialRef]`
- `migrateCredentials` is idempotent (existing store entries are skipped), preserves original config values on per-field failure, and never prints credential values `[credential-migration.ts:migrateCredentials]`
- Migration rewrites config via a `0o600` temp file + rename and retains a `0o600` backup until the write succeeds `[credential-migration.ts:migrateCredentials]`

## Side Effects
- Reads and writes the plain-file store under the platform data directory `[plain-file-provider.ts:PlainFileProvider]`
- Reads and writes `keychain-metadata.json` while values go to the OS keychain `[keychain-provider.ts:KeychainProvider]`
- Writes the encrypted envelope file `encrypted-store.json` with a random per-store salt `[encrypted-file-provider.ts:EncryptedFileProvider]`
- Reads and writes the `.backend` selector file in the credentials directory `[backend-selection.ts:writeStoredBackend]`
- Scrub deletes the plain-file store when switching away from it `[backend-selection.ts:scrubPlainFileStore]`
- Reads via the native `@napi-rs/keyring` binding on keychain operations and probes `[keychain-provider.ts:resolveKeychainEntryFactory]`
- Rewrites `~/.config/alix/config.json` for `setApiKey`/`deleteApiKey` `[api-keys.ts:setApiKey]`
- Migrates and rewrites user and project `config.json` files, creating backups `[credential-migration.ts:migrateCredentials]`
- Stores, rotates, and deletes SRAP HMAC keys through the credential store `[srap-evidence.ts:generateKey]`
- Emits an audit event per SRAP key read through the caller-supplied sink `[srap-evidence.ts:signCredentialRef]`

## Verification
- Run: `pnpm test`
