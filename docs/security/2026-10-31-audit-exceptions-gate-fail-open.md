# Supply-chain gate: audit-exceptions check was fail-open

Date: 2026-10-31
Branch: `fix/security-exceptions-gate-fail-open`
Baseline: `2fb57c25`
Status: **fixed; the gate now enforces its policy**

## What was wrong

`alix security supply-chain exceptions check` is the Sf.2 gate invoked by
`scripts/check-supply-chain.sh`. It reported a clean result for every
invocation and could not fail. **Four** independent defects combined — the
first three in the library and CLI, the fourth in the CI script itself, which
would have masked the other three even after they were fixed.

1. **`runExceptionsCheck` never evaluated the policy.** It called
   `loadExceptions`, then returned `ok: true` with empty `findings`,
   `expiredExceptions` and `unexcepted` arrays. `checkExceptionsPolicy` — the
   function that actually checks expiry and severity — was never called from
   the CLI path. Its unit tests were thorough and passed the whole time,
   because they exercised the policy function directly and not the entry
   point that CI uses.

2. **`parseAuditResult` did not understand pnpm's output shape.** It read
   npm's `{ vulnerabilities: { <name>: {...} } }`. `pnpm audit --json` emits
   `{ advisories: { <id>: {...} } }`, which parsed to **zero findings and no
   error**. Even with defect 1 fixed, a policy check fed by this parser would
   have passed on any dependency graph. Measured: 0 findings before, 15 against
   the current graph after.

3. **The handler ignored its subcommand.** `list` and `check` ran identical
   code, so `check` could not be distinguished from a listing. `list` also
   printed "Expired exceptions: 0" as a headline regardless of the facts.

4. **The CI script's fallback masked the primary check.** On any non-zero exit
   from the primary check, `check-supply-chain.sh` ran `npm audit --json` and
   passed whenever the parsed count was 0. This repository has no
   `package-lock.json`, so `npm audit` always failed with
   `{"error": {"summary": "Cannot read properties of null (reading 'matches')"}}`
   — which parsed to **0 advisories**, printing
   `✅ No npm audit advisories` and leaving `PASSED=true`. Fixing defects 1–3
   was therefore not enough: with every exception deliberately expired, the CLI
   exited 1 and the script still exited 0.

Concrete evidence of the fail-open: with all five exception entries expired on
2026-09-16, the gate reported "0 expired" and exited 0. Calling
`checkExceptionsPolicy` directly on the same file returned `ok: false` with
five `SC_EXCEPTION_EXPIRED` findings.

## What changed

- `runExceptionsCheck` now runs the audit, parses it, and routes through
  `checkExceptionsPolicy`. `listOnly` is an explicit opt-in used only by the
  `list` subcommand; a policy verdict cannot be produced without evaluating the
  policy.
- The audit runner reads the report from stdout because pnpm exits non-zero
  *when advisories exist*. A genuinely broken invocation returns
  `SC_AUDIT_FAILED` rather than a clean bill of health.
- Both audit shapes are parsed. Findings prefer the GHSA id when present, so an
  exception can be scoped to one advisory instead of pre-authorising a package.
- Valid JSON with neither known shape is a parse error, not an empty clean
  report. An explicitly empty `{}` for either key remains a legitimate clean
  result.
- `check` reports advisories evaluated/excepted/unexcepted; `list` reports
  declared exceptions. Both were previously mislabelled.
- `scripts/check-supply-chain.sh` falls back to `npm audit` **fail-closed**: an
  audit that cannot produce a usable report is a failure, not a pass. The
  non-numeric-result guard means stray output can never become an arithmetic
  comparison.

## Behaviour change now visible

In the current dependency graph the gate reports **4 unreviewed HIGH
advisories** — `nanoid`, `brace-expansion` (×2) and `source-map-js` — as
`SC_UNEXCEPTED_ADVISORY`. The gate still passes, because `failSeverity` is
`critical` and warnings do not fail it. But these were previously invisible, and
they are real outstanding debt, not satisfied exceptions. They are the same
findings flagged in
`docs/security/2026-10-31-embedding-migration-qualification.md` §8.

No exception was deleted, no expiry shortened, and no severity threshold raised
to reach this state.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` / `typecheck:unused` | PASS (0 unused) |
| `pnpm build` | PASS |
| `pnpm check:dox` | PASS (22 claim tokens, 3 AGENTS.md) |
| `bash scripts/check-supply-chain.sh` | PASS |
| `tests/security/supply-chain/security-exceptions.test.ts` | 23/23 PASS |
| `dependency-policy.test.ts` / `package-verifier.test.ts` | 24/24, 29/29 PASS |
| `tests/cli/security-doctor.test.js` | 8/8 PASS |

Probes on the fixed path:

- expired exception ⇒ `ok: false`, 1 `SC_EXCEPTION_EXPIRED`
- expired exception absent from the audit ⇒ `ok: false`
- unexcepted critical ⇒ `ok: false`
- broken audit invocation ⇒ `ok: false`, `SC_AUDIT_FAILED`
- unrecognised audit shape ⇒ `ok: false`, `SC_AUDIT_PARSE_FAILED`
- explicit empty report ⇒ `ok: true`
- `pnpm audit --json` ⇒ 15 findings (was 0)

End-to-end gate probes, run with every exception temporarily expired and the
file restored afterwards:

| Scenario | `exceptions check` | `check-supply-chain.sh` |
|---|---|---|
| current tree | exit 0 | exit 0 |
| all exceptions expired (before the script fix) | exit 1 | **exit 0 — masked** |
| all exceptions expired (after the script fix) | exit 1 | exit 1 |

Tests are verified non-vacuous by sabotage: restoring the "always ok" return
fails 2, ignoring the pnpm `advisories` map fails 3, and removing the
unknown-shape guard fails 1.

## Residual risk

The gate now fails on expired exceptions and on **critical** unexcepted
advisories. Unreviewed **high** advisories are warnings only, so they are
reported but do not block. That is the repository's configured posture
(`failSeverity: critical`), not a defect introduced here — but it means "the
gate passes" still does not imply "no unreviewed high-severity exposure". The
four current high advisories are the concrete instance of that gap.

The `$schema` reference in `security/audit-exceptions.json` points at a file
that does not exist in the repository, so the document has no live schema
validation. Pre-existing; not addressed here.
