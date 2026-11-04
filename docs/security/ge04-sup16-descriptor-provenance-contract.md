# GE-04 SUP-16 — Descriptor provenance fail-closed contract

**SECURITY HOLD: a pure policy prototype, NOT process isolation or authorization.**

`experiments/ge04/descriptor-provenance-contract.py` models a deliberately strict fixture rule: if reported descriptor origin and holder PIDs disagree, delegation is indicated, freshness or independently pinned role is absent, or evidence is malformed, the result is `UNVERIFIED`. Even the nominal same-holder path returns only `SAME_HOLDER_CLAIM_UNTRUSTED`, never admission. Its inputs are caller-supplied claims and **not independently verified kernel facts**. The negative contract regression is registered in Linux GE-04 CI.

**Known counterexample:** SUP-15 demonstrates that a socket transferred via SCM_RIGHTS can carry a valid precomputed request while SO_PEERCRED continues to identify the original connector. This contract cannot discover hidden transfers without an independent holder-attestation mechanism. It is not a mitigation and must not be wired to production authorization.

**Distinct-UID experiment added (pending privileged CI qualification):** `test-distinct-uid-fd-transfer-root.py` launches a fresh exec'd Python helper (`sup16-distinct-uid-child.py`) with UID/GID 65534 and no inherited secret-state objects. It demands direct key/socket pathname denials, then deliberately transfers an already-open Unix socket via `SCM_RIGHTS` and verifies that the helper can send a precomputed authenticated inert request. This reproduces the delegation gap and is **not** a containment success. The parent observes unchanged `SO_PEERCRED`. A real privileged CI PASS is required before reporting these observations as validated.

**Not accomplished:** No trusted role bootstrap, protected production key custody, enforced file-descriptor containment policy or complete transfer-denial control is established. Root-only direct-access tests and deliberate delegation reproduction do not establish a safe production supervisor. The production `UnavailableScopedMutationService` remains disabled; PR #1039 remains unmerged.

**Required future proof:** Independent role/credential provisioning under an OS service manager; isolation of secrets and inherited/SCM_RIGHTS descriptors; explicitly allowlisted IPC and deny-by-default child descriptor inheritance; tests across actual distinct UIDs, process termination and restart; a verified final mutation boundary and durable receipt. Never promote any `UNTRUSTED`/`UNVERIFIED` result to an execution grant.
