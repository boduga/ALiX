# GE-04 R2R — Provider-independent monotonic witness architecture

**Disposition:** Architecture seam implemented for qualification. **GE-04 SECURITY HOLD ACTIVE.** No anchor provider deployed; no production supervisor, recovery ledger, approvals or governance policy decision path is wired to it.

## Architectural decision

Keep a single evidence-consumer contract in the **existing** ALiX governance/security/evidence boundary:

- `src/governance/security/evidence/monotonic-witness.ts`
- `MonotonicTrustAnchor.readProtectedSnapshot()`: one read-only interface for independently supplied protected witness identity, pinned Ed25519 key and exact revision/policy/checkpoint head.
- `assessMonotonicWitnessEvidence(anchor, receipt, challenge)`: a read-only, fail-closed assessment of a signed witness receipt against the supplied independent snapshot and an ALiX-verifier-consumed challenge.
- Result shape is deliberately **not authorization**: `status:'blocked'`, `authorizationGranted:false`, `witnessAuthorityQualified:false`, and `rollbackResistant:false` even on matching evidence.
- No branch in the assessment grants worker admission, clears supervisor recovery records, alters approval outcomes, publishes a checkpoint or advances a monotonic counter.
- No default provider, local JSON production fallback, dependency on ideapad, or automatic key fetch from witness VM is installed.

The witness server on Proxmox Ubuntu 10.1.1.13 stays a **qualification-only signing service**. Its existing Python R2G–R2R scripts remain isolated test/probe utilities, not a second ALiX governance runtime or policy engine. The TypeScript verifier is the one proposed integration seam; do not establish another competing witness adapter in coordination, TUI or CLI.

## Provider boundary — choose independently

Production candidates can include a **dedicated, separately administered TPM 2.0 NV monotonic counter service**, an independently administered hardware security module, or an audited append-only monotonic service with reliable anti-rollback protection. The provider MUST:

1. Enforce a nondecreasing revision independently of the Proxmox guest and any ALiX worker-controlled writable storage.
2. Authenticate witness public-key provenance and control rotation with explicit operator authorization.
3. Bind witness identity + revision + canonical ALiX `computePolicyRevision` fingerprint + checkpoint SHA-256 to the protected record, without replacing ALiX policy revision semantics.
4. Provide an atomic/fail-closed revision advance and durable read protocol under concurrent writers and partial crashes.
5. Detect loss, reset, rollback or substitution of provider identity/credentials, and fail closed.
6. Be independently administrable and testable from a separately reviewed root of trust. The provider MUST NOT be able to approve policy, authorize workers or clear recovery records itself.

**A development laptop is not a recommended permanent authority.** The ideapad's TPM can be used as an optional, explicitly approved research fixture, but no TPM state will be modified for this milestone. A single standalone witness VM on Proxmox does not satisfy the independent-authority requirement if the same administrator can roll it back together with the purported floor.

## Security contracts and caveats

- The current contract checks an **exact** revision/head against the read-only anchor snapshot. This intentionally refuses signed revisions newer than a stale snapshot; there is no automatic advancement or implicit downgrade.
- The current port assumes the provider supplies independently authenticated data, but **does not prove that assumption**. A malicious or user-controlled provider can fabricate its own floor. Deployment qualification must establish provider provenance and a protected monotonic state machine before considering hold release.
- A boolean `consumedByVerifier` in a caller-supplied challenge is **only a qualification assertion**, not proof of single-use custody. The production boundary must obtain that fact from ALiX's canonical durable nonce/authorization storage, with atomic consume, fail-closed restart and independent rollback protection.
- Exact receipt canonicalization is compatible with the current R2P JSON field set, but cross-language signature and key-rotation integration tests are still required before production use.
- Existing ALiX approval and supervisor recovery authorities remain untouched. A passing `evidenceConsistent` result never means `authorizedForWorkerLaunch`.

## Verification and next gate

- `tests/agents/ge04-r2r-monotonic-witness.vitest.ts`: signed positive consistency, provider missing/outage, rollback/gap, key tampering, digest mismatch, wrong nonce/boot/identity, invalid snapshot/receipt and explicit no-authorization invariants.
- No TPM utilities installed or NV indices provisioned. No operator-independent key ceremony completed. No protected provider implemented.
- Required next step: independently select, deploy and qualify a real trust provider; only then revisit protected nonce custody, cross-host fault tests, and an explicit GE-04 security review.
- All documentation and qualification evidence must be stored in ALiX, not on microcloud3.

This decision supersedes any earlier suggestion to make ideapad TPM the mandatory ALiX production root.
