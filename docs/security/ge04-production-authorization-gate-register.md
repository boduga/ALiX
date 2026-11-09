# GE-04 — Production Authorization Gate Register

**Status: SECURITY HOLD ACTIVE.** This is an implementation and acceptance register,
**not** a release ticket, production operator attestation, or approval.

## Scope and authority

The three target operations are:

1. `checkpoint.commit` — authenticated independently governed publication and atomic protected-head advance.
2. `worker.execute` — privileged, credential-bearing execution under the canonical ALiX governance/approval/broker/supervisor chain.
3. `worker.recover` — justified recovery only after durable ownership, process identity, tool/approval and independent witness reconciliation.

No witness, signature, trust monitor, readiness report or operator name may become a second policy authority. **ALiX governance remains sole authority.** These operations can become available only following separate security and release decisions, not through a configuration flag in this qualification branch.

## Current integration boundary

`src/governance/security/evidence/ge04-native-governance-readiness.ts` adds a **non-authorizing, unwired** typed assessment. It checks native `computePolicyRevision(config)` against a strict candidate publication and reports operation-specific blockers. Unknown claim fields (including fake `authorizationGranted`) are rejected. A matching fingerprint is never evidence of signing, provenance or release authorization. The assertion API always raises `GE-04 SECURITY HOLD`.

Existing Python R2S tests use a synthetic policy document and publication signing key; that is **not the canonical ALiX governance publisher**. R2R witness reader accepts caller-provided floor snapshot and nonce-consumed boolean. R2S SQLite custody, CAS, dual-role TLS, and enrollment signature checks are test/qualification slices, not independent production trust.

## Required, separately evidenced acceptance gates

| Gate | Responsible authority | Evidence needed | Current disposition |
|---|---|---|---|
| G1. ADR-0018 final adoption and threat model | Maintainer + independent security reviewer | Approved ADR; STRIDE and failure-domain decision | **Unmet** — proposed |
| G2. Native policy publication issuer | Canonical ALiX governance owner | Verified end-to-end publisher identity; exact native `computePolicyRevision`; independent signing key custody; immutable approval binding | **Unmet** |
| G3. Independently administered protected anchor | Separate anchor operator | Protected monotonic integer **and** checkpoint digest, atomic CAS, hardware/service provisioning, administrator and snapshot separation | **Unmet** |
| G4. TLS identities and revocation | Security operator | Distinct client CA, expiry/revocation, certificates tied to publisher/committer/service roles, no shared root admin | **Unmet** |
| G5. Durable verifier nonce and endorsement custody | Canonical security-state owner + external operator | Atomic issue/consume, replay protection across crash/restore, independent rollback protection, audited idempotency, adverse concurrency | **Unmet** |
| G6. Cross-host fault qualification | Independent test operator | Real VM snapshot rewind, power loss, network partition, split-view, key compromise, stale/colliding publication, clock/epoch rotation | **Unmet** |
| G7. Worker native containment and broker | Supervisor/broker owners + security reviewer | Trusted Linux launcher and native process/cgroup attestation; credential escrow, exact principal/grant/attempt binding, no same-UID escape; final-effect TOCTOU tests | **Unmet** |
| G8. Recovery reconciliation | Recovery ledger/supervisor owner | Full tree termination/orphan quarantine, boot/PID generation fencing, serialized ownership, nonce consumption, no stale approval reuse | **Unmet** |
| G9. Independent review and Q13 release | Authorized security owner + Q13 governance | Signed security review, approval records, platform-specific certification, explicit GE-04 hold disposition | **Unmet** |

## Runtime enforcement sequence once independently qualified

```text
Native governance computes current policy fingerprint
    -> authenticated canonical publication (not fixture signature)
    -> independently enrolled publisher proposes exact head
    -> independently enrolled committer validates policy + prev floor
    -> externally protected, atomic monotonic CAS + idempotency journal
    -> challenge-bound signed read + durable verifier nonce consumption
    -> independent checkpoint monitor verifies non-equivocation
    -> ALiX governance policy/approval/revocation checks
    -> (worker) native broker/supervisor containment + final-effect gate
       OR (recovery) durable process/ownership reconciliation and fencing
    -> separately approved release state permits the specific operation
```

Any failure, inconsistent epoch, uncertain commit, missing proof, suspended approval, process generation change, unavailable operator, or stale checkpoint **blocks**. A signed witness receipt alone **never** allows execution or recovery.

## Deployment safety instructions

- Do **not** run real witness/anchor provisioning against the existing qualification VM as if it were an independent operator.
- Do **not** copy private signing keys into the ALiX repository, test fixtures, PR comments, logs, or ChatGPT.
- Do **not** merge stacked draft PRs directly without considering their dependent bases.
- Do **not** clear GE-04 hold because local tests or GitHub CI are green.
- Keep the live production admission path unchanged. Only independent owners may authorize and evidence the external security gates.

**Next external action required:** identify and provision actual independent operator, signing-key custody and protected anchor infrastructure, then run cross-host destructive qualification and independent security review. Until that is done, granting the three operations would violate the intended GE-04 invariants.
