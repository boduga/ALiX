# GE-04-R2H custody-manifest consistency evidence - 2026-11-08

## Security status
SECURITY HOLD ACTIVE. No privileged recovery authority was established. No worker launched, credential transmitted, ledger record cleared, or custody released.

## Implementation (local ALiX working tree, uncommitted)
- scripts/ge04-r2h-recovery-manifest.py
- tests/agents/test_ge04_r2h_recovery_manifest.py

Read-only descriptor-relative opening of protected manifest path components, O_NOFOLLOW and file fstat checks, strict JSON schema, matching durable registration identity / worker attempt / pid / uid / start-time ticks / Linux boot ID / expected cgroup device and inode. No authorization output, always blocked.

## Local tests
- R2H 10/10 Python unittest PASS
- R2G 8/8 Python unittest PASS
- R2A-R2F existing Vitest suite 35/35 PASS
- pnpm typecheck PASS

## Live guest fail-closed check
Guest alix-ge04-kvm01, Debian kernel 6.12.115+deb13.1-amd64.
Missing protected independent manifest at /etc/alix-ge04/nonexistent-manifest.json returns:
status=blocked, manifestVerified=false, reason=manifest unreadable or untrusted: FileNotFoundError.
This is a negative test only; no real privileged manifest was provisioned.

## Limits
No authenticated independent issuer, no protected exclusive manifest writer, no pidfd binding, no pinning of all mount identities, no proof of hostile descendant termination or recovery clearance. Test fixture uses required_uid injection to test protected paths as nonroot; this is not production-authorized configuration. Nothing in R2H automatically authorizes admission.
