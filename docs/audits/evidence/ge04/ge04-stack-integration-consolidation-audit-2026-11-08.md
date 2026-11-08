# GE-04 Stack Integration and Consolidation Audit — 2026-11-08

**Disposition:** Integration plan / no merges / no PR closures / GE-04 SECURITY HOLD ACTIVE.
**Repository:** `boduga/ALiX` · physical development host `ideapad`.
**Head audited:** `origin/feat/ge04-r3-local-trust-service-qualification` (PR #1084).
**Main audited:** `3599c1fd` (PR #1069), merge base `f39d1b70230ac4196bfbbaf295004bb8bb12f947`.

## Executive decision

**Freeze new GE-04 qualification micro-PRs.** Merge simulation is currently
conflict-free, but the review structure is overfragmented and the TPM/local
trust service is still qualification-only. Adopt **three logical review groups**
without deleting branches or prematurely lifting the security hold:

1. **GE-04 foundation:** existing umbrella **#1060**. This already contains
   the commits reviewed separately in **#1070–#1073**.
2. **R2S evidence and native-policy readiness:** proposed cumulative
   review **#1074–#1081**, with #1081 as the group tip, stacked on #1060.
3. **Single-device TPM and local IPC qualification:** proposed cumulative
   review **#1082–#1084**, with #1084 as group tip, stacked on #1081.

These are **proposed review boundaries**, not changed GitHub bases or merged
PRs. Retain existing branch/PR history until maintainers agree to the plan.

## Observations (direct Git/GitHub checks)

| Observation | Result |
|---|---|
| Current `main` at audit | `3599c1fd` |
| Latest GE-04 tip at audit | `851b7f6e` (#1084 before audit-only note) |
| Commits unique to GE-04 tip vs `main` | **104** |
| Commits unique to `main` vs GE-04 tip | **1** |
| Cumulative diff | **195 files**, 13,787 additions, 76 deletions |
| `main` paths changed since merge base | **3** |
| GE-04 paths changed since merge base | **192** |
| Identical paths modified on both sides | **0** |
| `git merge-tree --write-tree main tip` | **success**, tree `05e7d63a...` |
| GitHub #1070–#1084 | **MERGEABLE / CLEAN** when inspected |
| GitHub #1060 | **MERGEABLE / BEHIND** when inspected |
| Worktree during audit | Clean before report creation |

The cumulative 195 changed files comprise 65 `docs/`, 61 `tests/`,
34 `scripts/`, 25 `src/`, 8 `native/`, plus `.gitignore` and
`package.json`. The path totals are not commit counts or independent
deployable features. There are many qualification test fixtures.

**Caution:** zero overlapping paths and a clean merge-tree are time-bound
merge-compatibility evidence, not semantic integration or security proof.
The `main` branch can change after this review. Do not infer safety from
GitHub's per-PR `CLEAN` result alone.

## Duplicate review lineage — why the existing PR list is misleading

The umbrella **#1060** points at `feat/ge04-r1b1-supervisor-contract`.
It includes **#1070, #1071, #1072 and #1073** by Git ancestry:

| PR | Relative to #1060 head | Interpretation |
|---|---|---|
| #1070 | Ancestor, four commits behind | Review slice already in umbrella |
| #1071 | Ancestor, three commits behind | Review slice already in umbrella |
| #1072 | Ancestor, two commits behind | Review slice already in umbrella |
| #1073 | **Identical HEAD** to #1060 | Entire umbrella tip, different PR base |
| #1074–#1084 | 1–11 commits **after** #1060 | Actually incremental work |

**Do not treat #1060 and #1070–#1073 as independent additions to merge.**
Their base/head relationships intentionally enabled narrower review, but
separate merge actions could produce redundant PR outcomes and confusing
history. Once reviewers accept #1060, mark the duplicate *review intent*
superseded or resolved in GitHub **after explicit maintainer approval**;
do not delete branches.

## Architecture overlaps and ownership decisions

### A. One governance policy authority — KEEP, integrate once

`src/governance/security/evidence/ge04-native-governance-readiness.ts`
checks ALiX's native `computePolicyRevision` fingerprint and **always
blocks** checkpoint commit, worker execution and recovery. R2S Python policy
publication remains a distinct signed fixture. Do **not** create competing
policy engines, bypass approval expiry, or promote fixture signatures to
native issuer evidence. The native governance publisher and final-effect
approval checks are not wired here.

**Owner:** canonical ALiX governance and approval subsystems.

### B. One trust-anchor/checkpoint interface — CONSOLIDATE DESIGNS

The R2R `MonotonicTrustAnchor` interface accepts caller-provided evidence;
R2S anchor protocol, SQLite CAS, endorsement custody and enrollment fixtures
exercise pieces of the trust problem. The R3 TPM simulator models NV Extend
plus SQLite intent; the read-only inspector and NV contract validate shapes.

These are **not interchangeable production anchors**. Consolidation should
retain test vectors and security-negative cases but define **one typed
boundary** for `readHead`, `prepareIntent`, `observeHardware`,
`reconcile`, and explicit evidence provenance. The production boundary
must be a separately reviewed local trust service with real TPM hardware
authorization and externally retained enrollment reference. A signer or
SQLite-only store cannot claim rollback resistance.

**Owner:** governance security evidence (contract); independently reviewed
trust-service implementation (hardware backend).

### C. One peer identity and transport boundary — REUSE, do not duplicate

R2K/Q2 and other GE-04 Linux tests already exercise `SO_PEERCRED`,
connected-FD delegation, process identity and denial. R2S mTLS fixtures
exercise remote transport. R3 inert local AF_UNIX listener is another
qualification-only transport, NOT an installed daemon or a second production
identity/approval path.

For the one-device deployment, select AF_UNIX as the primary proposed
transport, retain mTLS as a separately scoped remote/qualification backend,
and **reuse existing peer/FD custody evidence and primitives** rather than
creating another independent authorization classifier. Peer identity is not
a capability or a publication authorization.

**Owner:** Linux broker/service runtime boundary; governance handles policy.

### D. Worker supervisor/recovery — KEEP existing canonical abstractions

The `src/agents/worker-supervisor*.ts` family already separates supervisor,
native launcher, admission coordination, durable launch, recovery ledger,
kernel observation, stop/attach and cgroups. Do not build a TPM-owned
worker scheduler/supervisor. The trust anchor may produce **evidence** only;
canonical approval, supervisor, broker and final-effect checks still govern
execution/recovery. Availability and release of privileged execution remain
unqualified.

**Owner:** agent worker supervisor/broker/recovery components.

### E. Preserve qualification tests, but stop multiplying production seams

All **27 changed `scripts/ge04-*.py` files** in the cumulative diff have
**zero direct references from `src/`** by a repository search of their
filenames. They are predominantly controlled test/evidence models, not
27 new ALiX runtime subsystems. Consolidation should group their cases in
coherent test suites and document fixture-only provenance; avoid wiring
these scripts directly into trusted runtime. Distinct test vectors should
not be deleted merely because they check similar threats.

## Recommended dependency-aware integration sequence

1. **Freeze and review**: preserve branches, open PRs and existing audit
   evidence. No automatic PR retargeting, closing, rebasing or squashing yet.
2. **Approve foundations (group A)**: review #1060's cumulative 160-file diff,
   cross-platform CI and security gates. It is **not production clearance**.
3. **Unify R2S review (group B)**: use #1081 as cumulative tip after #1060,
   reviewing the eight new commits (#1074–#1081), paying particular attention
   to external-anchor assumptions that differ from single-device TPM.
4. **Unify R3 review (group C)**: use #1084 as cumulative tip after #1081,
   reviewing TPM simulator/inspector/contract/AF_UNIX fixtures (#1082–#1084).
   No TPM writes. Retain original PR branches for reference.
5. **One consolidated trust-service design**: update ADR-0018 to distinguish
   physical Linux host, TPM access, root/TPM administrator, reset/re-enrollment,
   and offline/external evidence custody. Choose a single service API and
   concrete identities before further feature PRs.
6. **Review readiness gates**: require original G1–G9/Q13 signoff, end-to-end
   native publication, privilege isolation, real NV authorization, crash and
   rollback fault injection, recovery, and independently approved release.
   No GE-04 hold clearance from test green alone.

**Git review operations (proposed, do not run without approval):**
retarget #1081's base to #1060's head and #1084's base to #1081's head,
then review the cumulative diffs; after acceptance, mark intermediate
review-only PRs redundant/superseded without deleting any branch. Before any
merge, repeat `git fetch`, `git merge-tree --write-tree`, cross-platform
CI and policy/security review on the exact integration tip.

## No-mutation audit statement

During this audit, Git operations were `fetch`, `status`, `diff`,
`rev-list`, `merge-base`, `merge-tree --write-tree`, log inspection,
and GitHub PR read-only status queries. `merge-tree` wrote an **unreferenced
tree object**, not a working-tree merge. No PR was merged, rebased, retargeted
or closed, no hardware TPM operation was invoked and no security authority
was granted.

**Final assessment:** Git merge conflict risk **low right now**; review and
architecture integration risk **high until consolidated**. Freeze
qualification micro-PR production and execute the above reviewed plan.
