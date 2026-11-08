# GE-04-R2J issuer-to-manifest consistency evidence — 2026-11-08

## Security disposition
SECURITY HOLD ACTIVE. No production worker admission, credential delivery, ledger clearance, issuer activation, custody takeover, or merge.

## Implementation (local ALiX worktree, uncommitted)
- scripts/ge04-r2j-issuer-manifest-binding.py (new)
- tests/agents/test_ge04_r2j_issuer_manifest_binding.py (new)
- scripts/ge04-r2i-issuer-custody.py (updated to ge04-r2i-v2 claim schema: adds issuer UID, boot ID and procfs start-time ticks)

## Test results
- R2J focused Python: 14/14 PASS
- R2G, R2H, R2I Python: 28/28 PASS
- R2A-R2F relevant Vitest: 35/35 PASS
- pnpm typecheck: PASS

## Trust boundaries
The check compares protected path/manifest and issuer claim data, validates expected issuer identifier, registration and worker process identity, kernel boot ID, procfs start ticks, lock contention and manifest immutability across reads. A held flock proves contention, NOT who holds it. A same-UID process can forge or alter custody; caller-provided expected issuer data does not authenticate a privileged issuer. PID and pathname races remain; privileged independent identity source and pidfd are not implemented. Even full consistency yields status=blocked, never clearance.

## Guest
Qualification-only verifier source copied from ideapad to microcloud3, and the approved transfer to guest qualifier@192.168.122.21 reported success on 2026-11-08 (tool call PID 75690). The live guest negative verifier execution has been submitted for separate user review and is NOT counted as passed.

## Next
Build independently authenticated cross-UID issuer/verifier boundary, kernel-pinned process and cgroup authority, hostile-worker containment evidence, and explicit recovery authorization before reconsidering the security hold.
