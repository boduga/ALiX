# GE-04-R2N protected policy revision anchor — qualification evidence (2026-11-08)

## Security disposition
SECURITY HOLD ACTIVE. No production issuer provisioning, worker admission, credential delivery, ledger clearance, policy update or merge. Qualification-only read-only check.

## Local new files, uncommitted
- scripts/ge04-r2n-policy-revision-anchor.py
- tests/agents/test_ge04_r2n_policy_revision_anchor.py

## Contract
Compare a separately stored protected anchor with policy revision and canonical JSON SHA-256, issuer UID/ID, boot ID, before/after identity content, protected ancestry and permissions. Distinct protected parents required. No implicit advancement of revision; only an exact anchored revision is accepted as *consistent*. Same-unprivileged-UID anchor and policy explicitly fails provenance check. Combining the R2N anchored check with R2M only records consistency, never clearance.

## Validation
- R2N focused Python 16/16 PASS.
- R2G-R2M Python full regression 82/82 PASS (includes R2N).
- R2A-R2F and R1B1 Vitest 35/35 PASS.
- pnpm typecheck PASS (exit 0).
- Dedicated Debian KVM guest read-only negative test: /etc/alix-ge04/policy.json and /etc/alix-ge04/anchors/revision.json missing => status=blocked, revisionPinned=false, policyProvenanceQualified=false, FileNotFoundError. No protected policy or anchor was created.
- One positive consistency fixture mocks independent root anchor ownership. This is NOT privileged provenance evidence.

## Unqualified requirements
A publisher trusted independently of worker/coordinator and privileged issuer, durable rollback-resistant monotonic revision, real separately owned and protected policy anchor, privileged update transaction, external authentication, pidfd-cgroup recovery custody and hostile-worker containment. An attacker able to roll back policy AND anchor together defeats exact-revision/digest checks. R2N may not authorize launch or recovery. Do not lift GE-04 security hold.
