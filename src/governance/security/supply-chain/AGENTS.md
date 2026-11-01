# DOX — Supply-chain governance

## Purpose

Gates what ALiX installs and ships: advisory exceptions, lifecycle-script
approvals, dependency version policy, and packaged-tarball verification. These
are the checks that decide whether a dependency is allowed into the tree at
all.

## Ownership

| Path | Responsibility |
|------|----------------|
| `security-exceptions.ts` | `security/audit-exceptions.json` — load, parse audit reports, evaluate the exception policy, top-level `runExceptionsCheck` |
| `dependency-policy.ts` | `security/lifecycle-script-allowlist.json` — which packages may run install/postinstall scripts; installed-tree extraction, `runLifecycleCheck` |
| `package-verifier.ts` | `runTarballVerification` — packaged-tarball contents and checksum policy |

Policy inputs owned elsewhere: `pnpm-workspace.yaml` (`allowBuilds`,
`overrides`, `saveExact`) and `package.json` (exact version pins, checked by
`scripts/verify-deps.mjs`).

Schema documents live at `security/schemas/` and mirror the interfaces above for
editor completion and review. Nothing in CI validates against them, so do not
treat a `$schema` reference as evidence that validation runs.

CLI surface: `src/interfaces/cli/commands/security/supply-chain.ts`
(`handleSupplyChain{LifecycleCheck,Exceptions,VerifyTarball}`). The CI entry
point is `scripts/check-supply-chain.sh`.

## Local Contracts

- **A gate must evaluate the policy, not describe the file.** The two are easy
  to conflate and the difference is a fail-open. `runExceptionsCheck` returned
  `ok: true` from nothing but successful file parsing, never calling
  `checkExceptionsPolicy`. Any new "check" entry point must route through
  `checkExceptionsPolicy`; a list-only path must never be reachable from a
  gate.
- **The audit parser must accept the shape the package manager actually
  emits.** npm reports `{ vulnerabilities: { <name>: {...} } }`; **pnpm reports
  `{ advisories: { <id>: {...} } }`**. A parser that understands only one shape
  reports zero findings — a clean bill of health — for the other.
- **A broken audit invocation is not a clean report.** If the audit cannot
  run, the result is a failure. pnpm exits non-zero *when advisories exist*
  while still writing the report to stdout, so that path reads stdout rather
  than treating the exit code as failure.
- **Exceptions may be keyed by package name or advisory id.** `checkExceptionsPolicy`
  matches `e.id === vuln.id || e.package === vuln.package`. A package-name
  exception therefore pre-authorises *any* future advisory for that package;
  scope to the GHSA id when the exposure is specific.
- **An exception is removed by fixing the vulnerability, never by wanting the
  gate to pass.** Before deleting an entry, match the exceptions file against
  the post-change audit and confirm the package/advisory no longer appears. A
  package-name exception can still match a *different* advisory.
- **Deny and "undecided" are different.** In `pnpm-workspace.yaml`
  `allowBuilds`, `false` records an explicit denial; an absent key fails closed
  with `ERR_PNPM_IGNORED_BUILDS`. Denied packages must **not** appear in
  `security/lifecycle-script-allowlist.json` — that file lists scripts ALiX
  permits. `verify-lifecycle-scripts.mjs` only walks approvals → allowlist, so
  it cannot detect a stale allowlist entry; check the reverse by hand when
  denying a package.
- **`lifecycle-check` reads the installed tree, not the lockfile.** A stale
  `node_modules/.pnpm` directory left by a previous branch makes it report
  packages that are absent from `pnpm-lock.yaml`. A lifecycle failure that
  names a version not in the lockfile is a dirty tree, not a policy violation:
  reinstall before acting on it, and never add an allowlist entry to silence
  it.
- **A transitive override is a deliberate exception to declared ranges.** Use
  `pnpm-workspace.yaml` `overrides` only when no upstream release fixes an
  advisory, scope it to the parent package (`"parent>child"`) rather than
  globally, and record why in a comment at the override plus an evidence doc.
  Verify the forced major version behaviourally against the parent's actual API
  usage — not by assuming semver compatibility — and note the removal
  condition.
- `failOnExpired` and `failOnUnexcepted` stay `true`. Do not delete an
  exception, shorten an expiry, or raise a severity threshold to make a gate
  pass.

## Work Guidance

- Changing either JSON policy file requires restating the *reason* for any entry
  whose justification changed, not just moving its expiry. An entry renewed with
  a stale reason is an unreviewed exception wearing a new date.
- Every direct dependency is pinned exactly (`saveExact: true`, and
  `verify-deps.mjs` enforces it). New dependencies are added with an exact
  version, not a range.
- Preferences: report warnings do not fail the gate (`failSeverity: critical`,
  `warnSeverity: high`). An unreviewed **high** is a warning, not a pass —
  treat it as outstanding debt, not as satisfied.
- Both policy files reference a `$schema` under `security/schemas/`. Those
  schema documents mirror the interfaces this module consumes, but nothing in CI
  validates against them — they are editor tooling. The structural checks that
  actually run are `validateSecurityExceptionsDocument` in
  `src/interfaces/cli/commands/security/doctor.ts` (exceptions) and
  `runLifecycleCheck` (allowlist). Do not treat the `$schema` line as evidence
  that validation happens.
- **A reference that no longer describes the tree is a finding.** An exception
  for a package that matches no advisory, or a `$schema` pointing at a file that
  was never added, reads as coverage that does not exist. `pnpm check:staleness`
  (`scripts/check-staleness.mjs`) fails CI on exactly that. It does not check
  expiry or advisory matching — those are the policy verdicts above, and a
  second implementation would drift.

## Verification

- `tests/security/supply-chain/security-exceptions.test.ts` — parses both audit
  shapes and evaluates expiry/unexcepted/severity policy.
- `tests/security/supply-chain/` — lifecycle policy and allowlist behaviour.
- `pnpm verify:deps` — exact-pin policy.
- End-to-end: `bash scripts/check-supply-chain.sh`.

## Child DOX Index

None.
