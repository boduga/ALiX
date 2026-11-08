# GE-04-R2S — Independent Trust Service Threat Model

**Status:** Draft / independent review pending, 2026-11-08. **GE-04 SECURITY HOLD ACTIVE.**
**Method:** STRIDE-like threats, attacker capabilities, trust boundaries, and failure-injection acceptance.
**Decision:** [ADR-0018](../architecture/adrs/ADR-0018-independent-trust-service.md). **Contract:** [GE-04 Trust Service Contract](ge04-trust-service-contract.md).

## Assets and security goals

Protected assets: ALiX policy revision digest and approval evidence, signed worker/recovery checkpoint identity, externally protected monotonic revision, witness signing keys and identity, publisher and verifier credentials, single-use challenge history, independent audit/checkpoint history, and security operator provisioning records.

**Security goal:** No single compromised worker, publisher credential, witness API, or guest VM may grant privileged worker execution or conceal a rollback. Stronger admin-compromise claims require demonstrably separate administrators and hardware/operational controls. Availability failure must not become authorization bypass.

## Actors and boundaries

| Actor | Boundary | Trust granted |
|---|---|---|
| Model, plugin, subagent, workload | Hostile execution/request content | None for witness, credentials or floors |
| ALiX governance / recovery | Existing policy, approvals, supervisor, ledger | Only ALiX authorization after independent evidence |
| Verifier | Authenticated trust-service read client with durable nonce custody | Read receipts; no publish, rotate or override |
| Publisher | Mutually authenticated checkpoint proposer | Proposal-only; no automatic policy or grant authority |
| Witness API | Separate unprivileged identity | Read and tightly scoped sign; no writer/administrator powers |
| Committer / revision anchor | Separate protected administrative and rollback domain | Atomic nondecreasing revision + checkpoint commitment |
| Security operator | Privileged human-controlled identity | Explicitly reviewed enrollment, revocation, migration and rotation |
| Proxmox administrator | Controls witness VM and its disk snapshots | Assumed capable of rolling back guest key+DB; must not control protected floor |
| Trust-anchor administrator | Controls external monotonic primitive | Must not be equivalent to single compromised Proxmox principal |

## Threat analysis

| ID | Threat / capability | Required countermeasure | Qualification oracle |
|---|---|---|---|
| T01 | Unauthenticated API caller or workload impersonation | Mutual authentication, identity-bound authorization, reject unknown/mis-scoped clients | Anonymous/wrong-client denied |
| T02 | Stolen verifier credential attempts advance or sign arbitrary state | Separate read / challenge / publish / commit / rotate identities | Wrong-role, revoked-cert negatives |
| T03 | Compromised publisher forges checkpoint or skips revision | Authenticate policy and issuer claims at canonical ALiX boundary; compare-and-advance with protected floor | Unauthorized issuer/duplicate/gap/fork denied |
| T04 | Guest VM snapshot rolls back key+SQLite | Anchor counter/checkpoint outside VM failure domain; client verifies independent floor | Restore old VM snapshot after floor advance → deny |
| T05 | Witness API compromised signs attacker-selected arbitrary checkpoint | Signing service constrained to committed protected head; independent signed/pinned floor, audit | Sign uncommitted head denied; outside-head signed receipt never accepted |
| T06 | Signing key exfiltration or key substitution | Protected/non-exportable keys where supported; enrollment ceremony, pinning, reviewed rotation/revocation | Wrong key/unauthorized rotation denied |
| T07 | Replayed, precomputed or stale nonce/receipt | CSPRNG nonce, durable verifier issue then single-use atomic consume, session/boot binding, TTL | Replays and restart resurrection denied |
| T08 | Concurrent writers or partial crash create forked revision | One serialized atomic floor advance, strictly increment, durable commit and idempotent recovery tokens | N-way race, kill at each durable boundary |
| T09 | Network MITM, TLS downgrade, compromised proxy | Mutual TLS or equivalent authenticated transport, pinned roots, protocol/cipher lifecycle | MITM, expired cert and downgrade blocked |
| T10 | Split view or equivocation to different ALiX verifiers | Independent checkpoint monitor + append-only consistency proof / protected register | Two conflicting signed views detected, quarantined |
| T11 | Clock drift or NTP outage invalidates freshness | Challenge-based freshness primary; time only with reviewed uncertainty budget | Wrong boot, stale nonce, clock skew negatives |
| T12 | JSON parser abuse, oversized input or endpoint DoS | Strict schema and size caps, bounded concurrency, timeouts, quotas, no parser ambiguity | Oversize/duplicate-key/flood fuzz tests |
| T13 | Host/process escape via API handler | Unprivileged service, systemd sandbox, no shell/network writes, restricted file and network access | Breakout/privilege escalation exercises |
| T14 | Log tampering, deletion or retention bypass | Export monitored, externally protected audit/checkpoint records | Local log deletion does not erase independent history |
| T15 | Privileged operator or CA compromise | Separate operator roles, MFA, credential revocation, emergency quorum/dual control | Single-operator unapproved rotation denied |
| T16 | Trust service/network outage or poisoned health endpoint | Authenticated evidence-based readiness; fail-closed protected operations | Service stop/partition/slowloris denied |
| T17 | Supply-chain compromise, unsafe package update | Pinned/verifiable artifacts, restricted build/deploy authority, SBOM and rollback-safe upgrade | Tampered image/config denied |
| T18 | Cross-tenant or cross-run evidence reuse | Bind audience, environment, worker/run/attempt, policy and checkpoint to issuing context | Cross-run/cross-environment transfer denied |
| T19 | Attacker resets or replaces external floor after disaster | Identity/epoch pinning; fail closed on clear/unknown epoch, operator re-enrollment | Counter reset or anchor identity switch denied |
| T20 | Same attacker controls Proxmox and anchor administrators | Explicit scope boundary; separate administrative ownership required | Attack graph review; do not claim independent control when shared |

## Trust service API and credential controls

- Prefer private network plus mutually authenticated TLS; private networking **alone is not authentication**.
- Challenge/read is distinct from publish/commit/rotate. No public arbitrary-sign endpoint; no worker, model, plugin, CLI or TUI directly invokes protected update APIs.
- Restrict listener, ports, request size, response size, concurrency, TLS versions, allowed client identities, keys and certificate issuance.
- Do not expose private signing keys, full state DB, TPM owner auth, operator recovery secrets or process debug endpoints to API workers.
- Explicit fail-closed behavior for stale certificates, unverifiable roots, network partitions, failed fsync, conflicting revision and mismatched provenance.

## Attack paths to model end-to-end

1. **VM compromise → forged head:** guest API or root controls signing key and SQLite; independent protected floor must expose mismatch. If guest can also advance floor without independent authorization, design fails.
2. **Publisher compromise → unauthorized advance:** publisher attempts revision N+1 with arbitrary policy or checkpoint; the existing ALiX governance authorization and separate committer must reject it.
3. **Compromised verifier → fraudulent single-use assertion:** current TS `consumedByVerifier: boolean` is caller-supplied; never treat it as production-proof. Obtain consume result from protected ALiX nonce custody.
4. **Admin confusion → key rotation:** copied key or hostname does not independently attest identity. Rotation requires explicit record with old/new public keys, epoch, revocation and authenticated operator approval.
5. **Outage → fail-open:** service unavailable while unresolved recovery ledger exists; protected worker launch/recovery remains blocked. Read-only/non-sensitive actions follow existing policy.
6. **Rollback then crash:** service and verifier restart around an uncommitted or mismatched floor advance; uncertainty blocks, not auto-retries or “success”.

## Security non-goals

- No claim of preventing compromise by a principal with control over *all* trust roots and their administrators.
- Not a substitute for process UID isolation, kernel credential custody, pidfd/cgroup checks or release signing.
- No claims that the qualification Ubuntu VM or local Git fixture is independently administered or rollback resistant.
- This threat model does not certify Linux ARM64, macOS, Windows or containers: those require independent native-platform qualification.

## Acceptance evidence

Security review requires recorded identities and trust-domain ownership; network and API fuzz/abuse tests; actual snapshot rollback with a separately protected floor; cross-process crash/restart/concurrency; signing-key theft and rotation simulations; split-view monitoring; independent audit retention checks; and full fail-closed admission tests. Preserve evidence under `docs/audits/evidence/ge04/`. No production enablement or GE-04 hold release follows automatically from any individual passing test.
