# ADR-0018 — Independent Trust Service for GE-04 Witness Evidence

**Status:** Proposed for architecture/security approval (2026-11-08). Operator-approved direction; **not** production security clearance or an accepted deployment.
**Deciders:** ALiX maintainer and independent security reviewer (approval pending).
**Supersedes:** The R2R suggestion that the development laptop's TPM be ALiX's mandatory permanent revision authority. Does **not** supersede ADR-0009, ADR-0013, ADR-0015 or the existing supervisor and governance owners.
**Related:** [Threat model](../../security/ge04-trust-service-threat-model.md), [service contract](../../security/ge04-trust-service-contract.md), [current architecture](../overview.md), [GE-04 witness deployment](../../ge04-r2q-qualification-witness-deployment.md).

## Context and decision drivers

GE-04 recovery qualification demonstrated that a signed receipt, an in-VM SQLite head, and a same-admin hash chain cannot establish independent rollback resistance. A Proxmox administrator can restore the witness signing key and revision database together. ALiX must work across supported host architectures and container/VM environments without a TPM on each client. The external security primitive must not fragment the 12-subsystem, four-layer ALiX architecture, duplicate approvals, or silently become an execution authority. GE-04 SECURITY HOLD is active.

## Decision

Adopt **one provider-neutral, independently administered network trust-service contract** for protected witness evidence. ALiX's existing `governance/security/evidence` boundary is the sole client-side verification integration point. The trust service is external infrastructure, **not** a 13th ALiX subsystem and **not** a scheduler, policy engine, approval store, issuer or recovery decision-maker.

The service signs challenge-bound witness head receipts. A distinct, independently administered protected monotonic anchor must commit their revision and policy/checkpoint identity outside the witness VM's snapshot and credential domain. Service authentication, write authorization, cryptographic identity and external checkpoint consistency are mandatory. ALiX performs its own policy, approval, supervisor containment and final-effect checks after evidence validation; a receipt alone never approves launch, replay, release, credential access or recovery.

The public `MonotonicTrustAnchor` *reader contract* may be backed by an independently verified service, HSM/TPM-backed service, or append-only externally audited authority. Clients MUST NOT require local TPM hardware. Supporting a transport on a platform does **not** certify that platform: current initial ALiX certification scope remains Linux x86-64 per Master PRD v2.10. Service availability does not permit fail-open behavior.

## Required trust and failure domains

1. **ALiX governance:** sole policy/approval/worker-admission authority, independent of external witness decisions.
2. **Witness API:** minimally privileged signing/reading identity; no policy or worker capabilities, no network mutation endpoint until independently specified.
3. **Protected revision anchor:** separate administrative and rollback domain from the witness guest and writable ALiX worker state, with durable nondecreasing sequence and witnessed checkpoint commitments.
4. **Authorized publisher:** may propose a strictly sequenced checkpoint but cannot rotate signing keys, change policy, self-approve, erase history or reset the protected floor.
5. **Security operators:** identity/key rotation, protected anchor provisioning and emergency intervention require separated privileged controls, recorded human approval and audit; compromise of one API or publisher credential must not be equivalent to compromise of all roots.

If all roots or their administrators fall under one compromised principal, independence is **not** established. Merely naming a remote VM or using mTLS does not meet this condition.

## Protocol/invariants

- Authenticate both ends (mTLS with pinned trust roots/SPIFFE-equivalent identity or another reviewed mutually authenticated channel); per-role authorization and credential lifecycle.
- Canonical versioned receipts bind witness ID, ALiX `computePolicyRevision` SHA-256 fingerprint, unique verifier-issued nonce, target boot/session, checkpoint digest and strictly increasing revision. Current R2P uses exact revision matching for qualification; no automatic floor advancement.
- Persist nonce issuance and single-use consumption in the canonical verifier security state; ensure crash/restart does not resurrect challenges; protected monotonic history cannot share the rollback domain of the witness.
- Reject stale/split-view/conflicting receipts, unavailable anchors, key substitutions, clock uncertainty where time matters, unsupported protocol versions, and non-atomic advances.
- Preserve a tamper-evident externally checked audit trail; signed checkpoints alone do not prevent equivocation.
- Deny security-sensitive operations on witness/anchor failure; incident response must not silently change the authority hierarchy.

## Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| TPM 2.0 on every ALiX client | Reject as mandatory | Not available in all devices/VMs; lifecycle complexity and portability impact |
| Ideapad TPM as permanent floor | Reject | Development-host availability/administration coupling; not a production trust domain |
| Current Ubuntu witness VM + its SQLite only | Reject for production | Full VM snapshot can roll back key and state together |
| Git history or a second ordinary SQLite DB as trusted floor | Reject as sufficient | May share administrator/rollback authority; not inherently monotonic |
| Independently administered network trust service with protected external anchor | **Select as target** | Portable client protocol, separate administrative control, explicit provider qualification |

A managed provider, dedicated service or hardware-backed operator may implement the trust root. No specific vendor or storage provider is approved by this ADR.

## Consequences

- New attack surface: network APIs, client credentials, service deployment, signing custody, privileged publication, key rotations and denial of service. Address in the threat model and contract, not through a second ALiX authorization path.
- Additional operational dependency: ALiX protected admission/recovery pauses when the service/anchor cannot provide verified evidence. Read-only/non-sensitive operation remains subject to existing local policy.
- Explicit implementation gates: design approval; independent identities/provisioning; authenticated transport; real monotonic anchor; destructive fault testing on isolated infrastructure; independent security review; separate Q13 release authority.
- `src/governance/security/evidence/monotonic-witness.ts` is an **unwired, qualification-only** verification seam. It accepts a supplied snapshot and a caller-supplied boolean consumed-challenge assertion; those inputs are not proven trust/nonce custody. Do not convert its consistency result into permission.
- Retain all historical R2P/R2Q/R2R evidence as time-stamped qualifications, not updated claims. The Ubuntu VM at 10.1.1.13 is qualification-only. microcloud3 is a disposable test rig.
- No hardware provision, activation, worker admission, hold release, commit or merge is authorized merely by this document.

## Review checklist

[ ] Independent security owner and trust-administration roles identified
[ ] Signing-key custody and protected floor ownership independently evidenced
[ ] Threat model and protocol accepted; identity/key rotation and rollback recovery approved
[ ] Cross-host adversarial and snapshot qualification complete, with evidence in ALiX
[ ] Existing governance/recovery integration and security hold disposition separately approved
