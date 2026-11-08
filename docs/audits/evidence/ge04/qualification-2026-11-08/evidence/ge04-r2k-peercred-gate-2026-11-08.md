# GE-04-R2K Unix peer credentials - qualification evidence (2026-11-08)

Security hold: ACTIVE. No independent cross-UID issuer qualified. No production admission, credential-bearing worker launch, recovery clearance, or custody takeover.

Implementation local to ALiX working tree, uncommitted:
- scripts/ge04-r2k-peercred-gate.py
- tests/agents/test_ge04_r2k_peercred_gate.py

SO_PEERCRED on accepted AF_UNIX SOCK_STREAM yields peer PID/UID/GID from kernel. Strict claim-schema matching with /proc/<pid>/stat generation and boot ID. Role separation checks compare against explicitly specified issuer UID, verifier EUID, and forbidden worker/coordinator UIDs. Outputs always status=blocked.

Verification:
- R2K Python 10/10 passed; R2G-R2J Python 42/42 passed (52 total).
- R2A-R2F Vitest 35/35 passed.
- TypeScript pnpm typecheck passed.
- Real AF_UNIX socket client PID/UID/GID observed in local tests.
- Distinct verifier UID is only simulated in unit tests; NO real cross-UID boundary was exercised.
- No live R2K guest probe executed or counted.
- Host-local and test-supplied issuer policies are NOT independently authenticated. SO_PEERCRED alone cannot prove privileged issuer intent, kernel-pinned PID lifetime, credential transport authority, or hostile-worker containment.

Next GE-04-R2L: isolated dedicated-guest true cross-UID read-only peer-credential denial proof with protected policy source; preserve hold.
