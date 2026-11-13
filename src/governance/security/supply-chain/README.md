# Supply-chain Governance

## Overview
Gates what ALiX installs and ships: dependency advisory exceptions, lifecycle-script approvals, dependency version policy, and packaged-tarball verification. The module decides whether a dependency may enter the tree at all and produces stable `SC_*` error codes for CI.

## Interface
- `runExceptionsCheck(projectRoot, exceptionsRelPath?, options?)` loads `security/audit-exceptions.json`, obtains an audit report, and evaluates the exception policy [security-exceptions.ts:runExceptionsCheck]
- `parseAuditResult(raw)` accepts both npm's `vulnerabilities` map and pnpm's `advisories` map [security-exceptions.ts:parseAuditResult] [security-exceptions.ts:parseAdvisoryMap]
- `checkExceptionsPolicy(auditFindings, exceptions, now?)` applies severity thresholds, expiry, and exception matching [security-exceptions.ts:checkExceptionsPolicy]
- `loadExceptions(path)` reads and validates the exceptions document [security-exceptions.ts:loadExceptions]
- `runLifecycleCheck(projectRoot, allowlistRelPath?)` inventories packages with lifecycle scripts and checks the allowlist [dependency-policy.ts:runLifecycleCheck]
- `extractLifecyclePackages(lockfile)` reads npm `package-lock.json` entries; `extractPnpmLifecyclePackages(projectRoot)` reads the installed pnpm tree [dependency-policy.ts:extractLifecyclePackages] [dependency-policy.ts:extractPnpmLifecyclePackages]
- `checkLifecyclePolicy(packages, allowlist)` evaluates approval and expiry [dependency-policy.ts:checkLifecyclePolicy]
- `versionMatches(version, range)` and `compareVersions(a, b)` implement the minimal supported semver range forms [dependency-policy.ts:versionMatches] [dependency-policy.ts:compareVersions]
- `runTarballVerification(tarballPath, options?)` lists and path-verifies a packaged tarball and computes a SHA-256 checksum [package-verifier.ts:runTarballVerification]
- `listTarballEntries`, `checkPathDeny`, `checkSecretContent`, and `verifyTarball` are the reusable tarball primitives [package-verifier.ts:listTarballEntries] [package-verifier.ts:checkPathDeny] [package-verifier.ts:checkSecretContent] [package-verifier.ts:verifyTarball]
- CLI surface: `src/interfaces/cli/commands/security/supply-chain.ts` (`handleSupplyChain{LifecycleCheck,Exceptions,VerifyTarball}`); CI entry point `scripts/check-supply-chain.sh`

## Invariants
- A gate evaluates policy, never merely parses the file: `runExceptionsCheck` routes through `checkExceptionsPolicy` unless `listOnly` is set, and `listOnly` is reserved for `list` [security-exceptions.ts:runExceptionsCheck] [security-exceptions.ts:checkExceptionsPolicy]
- A broken audit invocation is a failure (`SC_AUDIT_FAILED`), not a clean report; pnpm's non-zero exit with a report on stdout is read from stdout [security-exceptions.ts:defaultRunAudit] [security-exceptions.ts:runExceptionsCheck]
- Unrecognized audit JSON shapes are a parse error, never an empty clean report [security-exceptions.ts:parseAuditResult]
- Exceptions match when `e.id === vuln.id` OR `e.package === vuln.package`; a package-name exception authorizes any advisory for that package [security-exceptions.ts:checkExceptionsPolicy]
- Defaults are `failSeverity: critical` and `warnSeverity: high`; unexcepted findings at or above the fail threshold are errors, at or above the warn threshold are warnings, and below both are accepted [security-exceptions.ts:checkExceptionsPolicy]
- `failOnExpired` and `failOnUnexcepted` fail closed unless explicitly set to `false` [security-exceptions.ts:checkExceptionsPolicy] [security-exceptions.ts:ExceptionsFile]
- Expired exceptions are reported even when they match no current advisory [security-exceptions.ts:checkExceptionsPolicy]
- Lifecycle findings fail closed: an unlisted package produces `SC_LIFECYCLE_UNEXPECTED` and an expired entry produces `SC_LIFECYCLE_EXPIRED` unless the corresponding policy flag is `false` [dependency-policy.ts:checkLifecyclePolicy]
- A missing lockfile is `SC_LOCKFILE_MISSING`; an unreadable or unparseable lockfile or allowlist is an error result, never an empty approval set [dependency-policy.ts:extractPnpmLifecyclePackages] [dependency-policy.ts:loadAllowlist]
- `runLifecycleCheck` prefers `package-lock.json` and falls back to the pnpm installed tree only when that file is absent [dependency-policy.ts:runLifecycleCheck]
- A pnpm lifecycle inventory requires a readable `node_modules`; without it the check fails closed [dependency-policy.ts:extractPnpmLifecyclePackages]
- `versionMatches` supports exact, `*`, compound ranges, `>=`, `<=`, `>`, `<`, `^`, `~`, and treats a bare version as a minimum [dependency-policy.ts:versionMatches]
- `verifyTarball` skips directories, flags a warning above `maxScanDepth`, fails above `maxTotalFiles`, and rejects paths matching base or extra deny patterns [package-verifier.ts:verifyTarball]
- `runTarballVerification` path-verifies entries; content secret scanning is exposed through `checkSecretContent` for callers that read file bodies, and is not invoked by the tarball listing path [package-verifier.ts:runTarballVerification] [package-verifier.ts:checkSecretContent]
- An empty or missing tarball fails with `SC_TARBALL_UNREADABLE` or `SC_TARBALL_NOT_FOUND` [package-verifier.ts:runTarballVerification] [package-verifier.ts:listTarballEntries]
- Error code strings are stable and must not change [dependency-policy.ts:LIFECYCLE_ERROR_CODES] [security-exceptions.ts:EXCEPTION_ERROR_CODES] [package-verifier.ts:VERIFIER_ERROR_CODES]

## Side Effects
- `runExceptionsCheck` shells out to `pnpm audit --json` via `execFile` unless `auditJson` or `runAudit` is injected [security-exceptions.ts:defaultRunAudit]
- `runLifecycleCheck` reads `package-lock.json`, `pnpm-lock.yaml`, `package.json`, the allowlist file, and walks `node_modules` including `.pnpm` [dependency-policy.ts:runLifecycleCheck] [dependency-policy.ts:extractPnpmLifecyclePackages]
- `runTarballVerification` stats the tarball, runs `tar -tzf`, and runs `sha256sum`, skipping the checksum when that tool is unavailable [package-verifier.ts:runTarballVerification] [package-verifier.ts:listTarballEntries]
- All entry points are read-only with respect to the repository; they report findings and never rewrite policy files [security-exceptions.ts:runExceptionsCheck] [dependency-policy.ts:runLifecycleCheck]

## Verification
- Run: `pnpm test`
