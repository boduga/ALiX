# Governance Security

## Overview
Security primitives and protected-state authorities for ALiX governance. This package owns path-component validation, the legacy secret scanner, and the top-level grouping for audit, credential storage, trust evidence, Inspector authentication, platform state paths, structural redaction, and supply-chain policy.

## Interface
- `assertSafePathComponent(input)` — validates a single filesystem path component and returns it unchanged on success `[path-assert.ts:assertSafePathComponent]`.
- `SecretType` — closed union of `api_key`, `aws_key`, `aws_secret`, `private_key`, `password`, `token`, `secret`, `bearer_token`, and `basic_auth` `[secret-scanner.ts:SecretType]`.
- `SecretFinding` — finding record with `type`, `line`, `column`, redacted `context`, sanitized `value`, `confidence`, and `rule` `[secret-scanner.ts:SecretFinding]`.
- `SecretScannerOptions` — `minConfidence`, `customPatterns`, and `excludePaths` options `[secret-scanner.ts:SecretScannerOptions]`.
- `SecretScanner` — `scan(content)`, `scanOne(content)`, and internal `sanitize(value)` over line-by-line regex detection `[secret-scanner.ts:SecretScanner]`.
- `audit/` — tamper-evident hash-chained audit writer, checkpointing, locking, and verification: [./audit/README.md](./audit/README.md) `[audit/audit-chain-writer.ts:AuditChainWriter]`.
- `credentials/` — the single protected secret store and provider API-key resolution: [./credentials/README.md](./credentials/README.md) `[credentials/credential-store.ts:CredentialStore]`.
- `evidence/` — append-only trust evidence, config/skill history, and native-governance readiness: [./evidence/README.md](./evidence/README.md) `[evidence/evidence-store.ts:EvidenceStore]`.
- `inspector/` — Inspector authentication, principals, token binding, and route policy: [./inspector/README.md](./inspector/README.md) `[inspector/auth-store.ts:AuthStore]`.
- `platform/` — platform state-directory resolution: [./platform/README.md](./platform/README.md) `[platform/user-state-paths.ts:getUserStatePaths]`.
- `redaction/` — structural redaction classifications, profiles, detector, and graph walker: [./redaction/README.md](./redaction/README.md) `[redaction/redaction-policy.ts:createRedactionPolicy]`.
- `supply-chain/` — audit exceptions, lifecycle-script approvals, dependency policy, and package verification: [./supply-chain/README.md](./supply-chain/README.md) `[supply-chain/security-exceptions.ts:checkExceptionsPolicy]`.

## Invariants
- `assertSafePathComponent` rejects rather than sanitizes, so an unsafe component can never alias a safe one `[path-assert.ts:assertSafePathComponent]`.
- Rejected components include `..`, lone `.`, `/`, `\`, NUL, and the empty string via `REJECT_PATTERNS` `[path-assert.ts:REJECT_PATTERNS]`.
- Leading-dot names such as `.well-known` remain valid; only the exact standalone `.` and `..` are rejected `[path-assert.ts:REJECT_PATTERNS]`.
- Windows reserved device names are rejected case-insensitively, as are drive prefixes such as `C:` and absolute Unix paths `[path-assert.ts:WINDOWS_RESERVED]`, `[path-assert.ts:WINDOWS_DRIVE_RE]`.
- A non-string input throws instead of being coerced `[path-assert.ts:assertSafePathComponent]`.
- `SecretScanner` scans one line at a time and resets each global pattern's `lastIndex` before use, so repeated scans do not skip matches `[secret-scanner.ts:scan]`.
- Custom patterns are appended after the built-in defaults and therefore cannot suppress them `[secret-scanner.ts:SecretScanner]`.
- `SecretFinding.context` always returns `"[REDACTED]"`; raw source context is never exposed `[secret-scanner.ts:SecretFinding]`.
- `sanitize` preserves the first four characters and masks the remainder, or masks the whole value when it is four characters or shorter `[secret-scanner.ts:sanitize]`.
- Confidence is `high` for private keys, AWS keys, and API keys; `low` when the matched value contains `example` or `test`; `medium` otherwise `[secret-scanner.ts:getConfidence]`.
- `SecretScanner` is deprecated in favor of `SecretDetector` in `redaction/secret-detector.ts`; new code must use the redaction profiles `[secret-scanner.ts:SecretScanner]`.

## Side Effects
- `path-assert.ts` is pure: it performs no filesystem, network, or process access and only throws or returns its input `[path-assert.ts:assertSafePathComponent]`.
- `secret-scanner.ts` is pure in-memory regex work and mutates only its own patterns' `lastIndex` during a scan `[secret-scanner.ts:scan]`.
- The package itself writes no state; protected writes belong to the child authorities (`audit/`, `credentials/`, `evidence/`, `inspector/`, `supply-chain/`) `[credentials/credential-store.ts:CredentialStore]`.

## Verification
- Run: `pnpm test`
