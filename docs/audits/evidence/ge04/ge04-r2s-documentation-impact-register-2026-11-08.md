# GE-04-R2S — Documentation impact and acceptance register (2026-11-08)

**Disposition:** Documentation sequence 1–5 authored, cross-reference checked, pending independent review. ADR-0018 is **PROPOSED**, not independently accepted. GE-04 SECURITY HOLD ACTIVE. No production provider, privileged admission, hardware changes, commit or push.

## Canonical source hierarchy

1. `docs/architecture/adrs/ADR-0018-independent-trust-service.md`: why, authority separation, chosen architecture and decision status.
2. `docs/security/ge04-trust-service-threat-model.md`: the service-specific attack surface and failure-domain assumptions. Existing `docs/security/threat-model.md` is **Inspector-specific**, not superseded.
3. `docs/security/ge04-trust-service-contract.md`: proposed API, roles, signed messages, monotonic commit state machine, verifier failure behavior and gates.
4. Existing GE-04 contract documents: issuer, release, recovery, publisher/witness qualification constraints.
5. Master PRD v2.10 (existing file `docs/prd/ALiX_MASTER_PRD_v2.9.md`), architecture overview and living roadmap: product/architecture dependencies, **not** implementation certificates.
6. `docs/security/operations.md` and `docs/operations/operational-runbook.md`: operator runbooks. Historical `docs/audits/evidence/ge04/` records are retained unmodified.

## Impact matrix

| Stage | File | Change intent | State |
|---|---|---|---|
| 1 | docs/architecture/adrs/ADR-0018-independent-trust-service.md | New proposed architecture decision | Authored locally; review pending |
| 2 | docs/security/ge04-trust-service-threat-model.md | New STRIDE-style service attack model | Authored locally; review pending |
| 2 | docs/security/ge04-trust-service-contract.md | New service/identity/commit/verifier contract | Authored locally; review pending |
| 3 | docs/ge04-r2p-external-monotonic-witness.md | Explicit R2P-era historical status and new service supersession | Updated locally; review pending |
| 3 | docs/ge04-r2q-qualification-witness-deployment.md | Deployed VM vs proposed secure independent production service | Updated locally; review pending |
| 3 | docs/security/ge04-recovery-provenance-boundary.md | Independent evidence is necessary, never sufficient | Updated locally; review pending |
| 3 | docs/security/ge04-q32-trusted-issuer-contract.md | Publisher/committer separation and no witness issuer power | Updated locally; review pending |
| 3 | docs/security/ge04-q38-trusted-authority-integration-design.md | Canonical governance evidence seam | Updated locally; review pending |
| 3 | docs/security/ge04-release-custody-boundary.md | Release key/floor separate from witness service identity | Updated locally; review pending |
| 3 | docs/security/ge04-production-worker-lifecycle.md | Protected admission remains blocked on trust failure | Updated locally; review pending |
| 4 | docs/architecture/overview.md | External boundary, not a 13th subsystem | Updated locally; review pending |
| 4 | docs/architecture/ALiX_MASTER_ROADMAP.md | R2S gates, explicit dependencies/hold | Updated locally; review pending |
| 4 | docs/prd/ALiX_MASTER_PRD_v2.9.md | Version 2.10 draft addendum, portability within platform certification | Updated locally; review pending |
| 4 | docs/architecture/adrs/ADR-0009-security-integrity-audit.md | Non-superseding cross-reference to proposed ADR | Updated locally; review pending |
| 4 | docs/architecture/governance-infrastructure.md | Evidence provider not governance | Updated locally; review pending |
| 4 | docs/governance/governance-model.md | Policy/approval sovereignty | Updated locally; review pending |
| 5 | docs/security/operations.md | Key enrollment/rotation, audit and incident operator rules | Updated locally; review pending |
| 5 | docs/operations/operational-runbook.md | Safe startup/degraded/restore procedures | Updated locally; review pending |
| 5 | docs/audits/architecture-gap-analysis.md | Unimplemented independent trust and platform qualification | Updated locally; review pending |

## Explicitly retained without historical rewrites

- Previously signed/accepted ADRs, dated architecture audits, completed phase reports and original R2G–R2R test evidence.
- `docs/architecture/ma0-alix-architecture-2-0.md`: already marked **SUPERSEDED**; refer to current overview/roadmap, do not reinstate.
- `docs/security/architecture.md` and `docs/security/threat-model.md`: both Inspector-specific.
- Older PRD versions and archive branches: preserve as history; only amend current v2.10 draft.
- Qualification-only Python tools and TypeScript `MonotonicTrustAnchor` reader are not asserted production ready.

## Acceptance criteria for this documentation change

- All targeted paths exist and contain unique bounded R2S addenda with consistent links.
- No accepted ADR is silently superseded; ADR-0018 remains proposed pending review.
- Every document distinguishes desired service architecture, current deployed Ubuntu qualification, and future security qualification.
- No document implies a server-side API can approve workers or erase a recovery ledger, or a normal VM/database is independently rollback-resistant.
- No change declares Linux ARM64, macOS, Windows or container execution initially certified; Master PRD 2.10 Linux x86-64 scope remains.
- Git diff/check and cross-reference checks run; no code or production controls altered by documentation work.

## Completed authoring verification (2026-11-08)

- **Sequence 1–5:** all authored locally, including new ADR-0018, dedicated GE-04 threat model/security contract, GE-04 contract amendments, current PRD/roadmap/architecture and governance amendments, runbooks, gap register and this verification record.
- **Primary documents checked:** 19 (3 new + 16 amended; two amended R2P/R2Q files were previously untracked). No historical evidence was rewritten.
- **Relative-link check:** 60 local links resolved within the inspected scope; zero broken R2S local links. Checks were scoped to updated/created documents, not the entire repository.
- **Document authority:** ADR-0018 remains **PROPOSED** pending authorized independent architecture/security acceptance. Master PRD internal version 2.10 remains DRAFT. No statement claims production trust-service implementation or security clearance.
- **Cross-document controls:** Verified proposed ADR reference across all 19 primary docs; Linux x86-64 first-release scope unchanged; Inspector-specific threat model unchanged; superseded MA0 file unchanged.
- **Change validation:** `git diff --check` passed for tracked modifications. Existing uncommitted GE-04 code, tests, and separate historical evidence were preserved.
- **Outstanding approvals (not document-authoring failures):** maintainer/independent security signoff, real protected trust provider deployment, adversarial qualification, release authorization and explicit GE-04 security hold clearance.
- **Version control:** Local worktree edits only; no commit, push, merge, branch switch or external system change.
