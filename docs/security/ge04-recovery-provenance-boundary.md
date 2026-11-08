# GE-04 PR 7 — recovery and receipt provenance (offline, DENY ONLY)

**Status: research qualification and negative evidence examination only.**
GE-04 SECURITY HOLD remains active. The production
`createScopedMutationService()` factory continues to fail closed.

## Purpose

`src/execution/filesystem/recovery-evidence.ts` implements a bounded,
deterministic **read-only transcript examiner**, not an independently
authenticated journal or privileged replay controller. Every result is
`DENY / GE04_RECOVERY_NOT_QUALIFIED`, regardless of whether the transcript
appears internally consistent.

Events use a strict, canonical, versioned shape and record: sequence number;
previous-event SHA-256; attempt and worker IDs; policy revision; approval
and lease IDs; exact request digest; release digest; stage
(`prepared` → `effect_entered` → `receipt_reported`); claimed outcome;
claimed effect digest; and current event hash. A fixture checkpoint carries
the expected count and final hash.

The examiner tests continuity, field binding, authorized stage order,
strict schema, event hashing, checkpoint equality and bounded length. It
quarantines any attempt ID previously observed against automatic replay.
After an observed `effect_entered` event with no receipt, the outcome
remains ambiguous. A `receipt_reported` event claiming `success` is **not**
accepted as proof of a kernel effect.

## Limitations — mandatory independent gates

- **No independent trust root.** A hash chain by itself authenticates nothing:
  a same-UID or privileged adversary can replace the entire chain and its
  caller-supplied checkpoint. An independently administered, durable and
  rollback-resistant anchor has not been provisioned. In this PR,
  `expectedAnchor` is test input; passing it is not independent custody.
- **No real syscall provenance.** The reported effect digest and success/failed
  outcome are untrusted claims. Neither `stat` nor an apparently correct
  destination file establishes a trusted OS mutation receipt or binds it to
  an authenticated supervisor execution.
- **No durable writes or crash recovery implementation.** The library uses
  in-memory fixtures. Tests perform serialized snapshot/restart simulation
  only; they do **not** claim a new power-cut, fsync, independent process,
  SIGKILL or reboot proof. Existing D9 journal crash tests are separate
  from the GE-04 native qualification boundary.
- **No cross-attempt uniqueness authority.** A distinct attempt ID is not
  independently tied to the same effect or approval; a new ID therefore
  remains **DENY**, even if it is absent from a local transcript. A complete
  transaction-index and supervisor-led one-time consumption remain required.
- **No release or signer integration.** This layer cannot assert that the
  signed release, signing key, rollback floor, loader, process UID, approval
  and lease were independently pinned at the final syscall boundary.
- **No production use.** The module is not wired into a mutation service,
  approval consumer or filesystem router. No replay capability, permit,
  success attestation or trusted receipt is returned.

## Required acceptance before any future activation

1. Independent supervisor installation and security principal, trusted
   release and runtime provenance, operator-custodied signing and
   rollback-protected floor.
2. An authenticated, tamper-evident, rollback-resistant **external journal
   anchor** and a demonstrated atomic relationship between journal intent,
   native effect and the exact request/worker/approval/lease/release binding.
3. Real crash and power-loss fault injection proving fsync ordering,
   crash-before/after-effect handling, unambiguous reconciliation where
   possible, and quarantine when unknown. Never silently replay an
   ambiguous operation or accept an untrusted success receipt.
4. Trusted syscall-adjacent revalidation of policy, single-use approval,
   lease revocation, expiry and inode/mount constraints with adversarial
   same-UID and hostile path swap tests.
5. Independent human security review and explicit activation approval.
   Merging PRs #1041–#1047 cannot satisfy this by itself.

## Test evidence

`tests/execution/filesystem/recovery-evidence.test.ts` checks prepared-only
crash simulation, effect-entered without receipt, claimed terminal outcomes,
tampered/reordered chains, checkpoint truncation and mismatch, whole-chain
fabrication, phase and identity changes, new-attempt replay bypass,
oversized/malformed transcripts, and production backend denial on four
platforms.

**Disposition:** Can merge as isolated deny-only evidentiary contract after
passing CI, but must retain **GE-04 SECURITY HOLD**. This completes the
seven-PR research/remediation *scaffolding* sequence, not production
security qualification or native backend activation.

---

## R2S trust-service interaction (2026-11-08; future contract)

Protected witness receipts are additional **evidence**, not recovery verdicts. Under [ADR-0018](../architecture/adrs/ADR-0018-independent-trust-service.md) and the [service contract](ge04-trust-service-contract.md), the verifier must independently authenticate signing identity, durable single-use nonce consumption, externally protected checkpoint floor, exact ALiX policy fingerprint, worker/attempt and final-effect context. A matching signature or hypothetical local floor is insufficient. Evidence failures block; passing evidence does not clear the recovery ledger or prove kernel effect completion. The original offline recovery examiner's DENY-only behavior and all explicit unknown-outcome quarantine requirements remain unchanged.
