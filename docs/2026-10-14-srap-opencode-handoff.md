# SRAP-1 OpenCode handoff

Updated: 2026-10-14

## Mission and current gate

Continue SRAP-1 architecture work from G2-B into G2-C. G3 is blocked. Current
goal: resolve the documented G2-C blockers, reconcile contract/plan/ADR, then
request an independent G2-C review. Do not implement the remote decision route
until G2-C returns READY and the operator separately opens G3.

Baseline verified at start: `main` / `origin/main` / `HEAD` =
`2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e`.

## Authorized work already done

- RuntimeLedger now pins WAL + `synchronous=FULL` on every connection, reads
  settings back, and fails closed if either setting differs.
- Four durability probes pass: read-back after reopen, injected transaction
  rollback after event/entity writes, commit-before-ack SIGKILL/restart, and
  reopened WAL/FULL settings.
- RuntimeLedger and approval-ledger suites pass. Build and DOX validation pass.
- RuntimeLedger FULL benchmark shows ~14 writes/s and 76.86 ms/write versus
  NORMAL baseline ~279.7 writes/s and 3.59 ms/write (~95% throughput decrease).
- No SRAP endpoint was implemented. No commit or merge made.

## Read these artifacts first

1. `docs/2026-10-14-srap-g2-c-independent-review.md` — latest review and
   blockers; treat this as current status.
2. `docs/2026-10-14-srap-1-contract-proposal.md` — approved security direction, but needs
   blocker reconciliation.
3. `docs/2026-10-14-srap-1-implementation-plan.md` — planning draft. Some projection-repair
   wording is more definitive than G2-C evidence supports; reconcile before
   treating as implementation-ready.
4. `docs/architecture/adrs/ADR-0015-srap-one-ledger-decision-evidence.md` —
   persistence decision and measured FULL cost.
5. `docs/2026-10-14-srap-g2-a-architecture-security-verification.md` — G2-A
   findings.
6. `docs/AGENTS.md` and root `AGENTS.md` — applicable DOX and work rules.

Original inputs remain in `docs/2026-10-14-srap-option-b-design.md`,
`docs/2026-10-14-srap1-review-and-revised-plan.md`,
`docs/2026-10-14-srap-1-contract-proposal.md`, and
`docs/2026-10-14-srap-1-implementation-plan.md`.

## Decisions already approved

- One authoritative SQLite `approval.updated` event carries transition and
  remote decision evidence; do not add another approval authority or ledger.
- Runtime ledger uses WAL + FULL. This is repository-wide and affects all
  RuntimeLedger users.
- SRAP is bearer-only, default-off, and requires stable persistent `principalId`
  within existing Inspector auth.
- Eligibility requires authenticated caller, `approvals:decide`, active
  principal, explicit workspace scope, and approval-specific eligibility.
- Store versioned HMAC-SHA-256 credential references; never raw bearer secrets.
- Forwarded HTTPS/client address is trusted only from configured immediate-peer
  proxy CIDRs; parse unambiguous scheme and validated address chain.
- JSONL is a recoverable audit projection, never approval authority.
- Narrow DOX exception may allow one default-off, non-executing decision route;
  do not broaden browser write permissions or execution POSTs.

## Blocking decisions and evidence gaps

1. **Approval eligibility:** no deterministic `ApprovalScope` predicate exists.
   Recommend workspace-scoped operator may decide only while existing
   session/run/worker/binding and ownership facts remain valid. This reuses
   existing facts and avoids principal-specific approval grants. Operator must
   approve exact rule; do not invent one.
2. **HMAC key lifecycle:** Inspector auth store is hash-only and does not own
   secret keys. Assign an existing restricted credential-store namespace and
   define generation, activation, rotation overlap, retirement after evidence
   retention, unavailable-key behavior, access control, and audit. Do not add a
   new secret authority.
3. **Audit projection repair:** runtime outbox has no production projector.
   Current approval reconciler is read-only; audit writer lacks an atomic,
   `decisionId`-keyed idempotent append seam. Define audit-owned append/dedup,
   inline attempt, bounded startup/operator repair trigger, cursor/checkpoint,
   retry, duplicate/corruption/lag detection, and alerting. Do not mark generic
   outbox delivered or describe retries as already present.
4. **FULL performance:** measured sequential throughput fell ~95%. Need operator
   acceptance and representative supported-storage measurements for concurrent
   writers, readers, checkpoint behavior, and latency. Do not weaken FULL.
5. **Document ownership:** contract and plan are at docs root, whose DOX defines
   root docs as dated handoff/history. Reconcile durable live-contract location
   with DOX before G3; do not move files without preserving references and
   explaining the ownership change.

## Worktree and preservation

Worktree contains intentional SRAP edits plus unrelated untracked images and
workbench artifacts. Preserve them. Current SRAP-related changes include:

- Modified: `src/runtime-state/storage/runtime-ledger.ts` and three DOX files
  under approvals, server, and runtime-state storage.
- Untracked: G2-A/G2-C reports, contract, plan, ADR-0015, durability test, and
  `scripts/benchmark-runtime-ledger.mjs`.
- Other untracked files are unrelated; do not clean, stage, or overwrite them.

No commit/merge authorization exists. Do not commit, merge, or implement G3.

## Next steps

1. Read root/nearest DOX contracts; inspect current auth, ownership, credential,
   audit, and storage ownership code before proposing mechanics.
2. Produce concrete contract/plan/ADR redlines for the five blockers above.
   Distinguish approved decisions from recommendations needing operator approval.
3. Correct plan claims that imply an existing audit projector/reconciler can
   repair JSONL today.
4. Capture FULL representative storage benchmark methodology and results; keep
   benchmark script reusable. Do not claim power-loss proof from SIGKILL tests.
5. Run independent G2-C review only after text and ownership are reconciled.
6. Stop at G2-C. G3 remains closed until explicit approval.

## Verification already observed

- `pnpm build` — pass.
- `tests/storage/srap-approval-durability.test.ts` — four probes pass.
- Existing RuntimeLedger test — pass.
- `tests/approvals/approval-ledger-dualwrite.test.ts` and
  `tests/approvals/approval-store.test.ts` — pass.
- `pnpm check:dox` — pass outside sandbox. Earlier `HEAD` lookup failure came
  from sandbox blocking Node's nested git process; no tooling defect was found.
- GitNexus `detect-changes --scope all` reports critical risk for the global
  RuntimeLedger change, affecting 59 execution processes. Reassess impact before
  any source edits; graph analysis must be complete before commit.

Tests above describe prior run; rerun relevant checks after subsequent edits.
