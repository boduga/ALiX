# GE-04-R2I exclusive issuer custody prototype evidence - 2026-11-08

## Security disposition
SECURITY HOLD ACTIVE. Qualification-only local prototype; no independent privileged issuer qualified, no production admission, no manifest signing, no durable ledger mutation, no worker credential launch, and no custody takeover.

## New files (ALiX working tree, uncommitted)
- scripts/ge04-r2i-issuer-custody.py
- tests/agents/test_ge04_r2i_issuer_custody.py

## Contract
Protected directory traversal with O_DIRECTORY / O_NOFOLLOW; owner and permission validation; pre-existing protected issuer.lock with O_NOFOLLOW and fstat identity comparison; nonblocking flock LOCK_EX; atomic issuer.claim creation using O_CREAT | O_EXCL | O_NOFOLLOW and fsync of claim and directory. Claim remains sticky even if owner exits and lock is released. No release or stale-owner takeover operation.

required_uid parameter supports local nonroot test fixtures only; root-only usage would require independently authorized privileged deployment, still unqualified. Caller-controlled input does not confer trusted issuer authority.

## Evidence
- GE-04-R2I Python focused tests: 10/10 PASS.
- GE-04-R2G and R2H prior Python tests: 18/18 PASS.
- GE-04-R2A through R2F and R1B1 relevant Vitest: 35/35 PASS.
- pnpm typecheck: PASS.
- Live guest unprivileged rejection request has not been confirmed completed; a remote execution review was requested. No guest issuer custody was created.

## Remaining gates
Privilege separation from worker/coordinator; independently authenticated source of registration identity; mount and descriptor pinning at authority boundary; full hostile-worker containment and crash recovery; validated live guest privileged claim controls; explicit operator authorization of any recovery.
