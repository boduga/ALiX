# GE-04 SUP-27 — Adversarial verification and security release-blocker register

**Decision: SECURITY HOLD — REQUIRED. PR #1039 MUST NOT MERGE. Production mutation authority MUST remain unavailable.**

This is an internal experimental threat-model review, **not an independent security assessment or production certification**. All reproduction code operates only in isolated temporary test directories. CI reporting `PASS` means that the expected weakness was reproduced or that the test observed fail-closed behavior; it does **not** mean the system is secure.

## Evidence-backed blocking findings

| Finding | Severity | Reproduction | Why this blocks production |
| --- | --- | --- | --- |
| SUP27-F1: same-UID fixture state rewrite defeats revocation | Critical for any deployment trusting fixture state | `test-sup27-adversarial-boundaries.py` creates SUP-25 state, revokes the lease, then uses owner write permissions to restore `revoked=false` and the previous revision; a later inert `attempt` is accepted | `flock` serializes *cooperating* actors only. No protected authority boundary separates an attacker controlling the state directory from the decision engine. |
| SUP27-F2: fixture owner forges a MAC-consistent terminal observation | Critical for claims of authenticated effect receipts | Test fabricates an approved/consumed state and recomputes a matching SUP-26 HMAC using the fixture credential, without invoking `attempt`; `classify` returns `INERT_RECORD_MATCHED_EFFECT_UNVERIFIED` | Coordinator-controlled key and state can produce plausible-looking receipt evidence with no actual effect. HMAC is not an independently trusted terminal attestation. |
| SUP27-F3: even honest matching marker does not certify effects | Release-blocking design gap | Test completes an inert transition and creates a valid record; the only returned class is `INERT_RECORD_MATCHED_EFFECT_UNVERIFIED` | The record is not bound atomically to an OS-enforced mutation or to independently observed effect evidence. |
| SUP16: connected stream FD delegation bypass | Release-blocking unless old route excluded | Existing SUP-16 root-only CI reproduces a valid inert request sent through a deliberately delegated preauthenticated stream descriptor | `SO_PEERCRED` describes the original connector, not subsequent holder. New `SO_PASSPIDFD` datagram experiments do not repair old stream transport. |

## Existing experimental evidence (not release evidence)

- SUP-20/21: datagram sender credentials and rejected ancillary FDs.
- SUP-22/22b: pidfd lifecycle and per-message kernel-delivered sender pidfd. Runtime kernel support and PID namespace assumptions still require operational validation.
- SUP-23: root-owned separate subprocess and path isolation from distinct UID 65534; the root launcher can still interfere with the root child and protected files.
- SUP-24: nonce freshness and rejection of cross-restart stale messages; not production request authentication.
- SUP-25: durable cooperative single-use approval/lease/policy/revocation state under a lock; not independent authority or real effect enforcement.
- SUP-26: fixture HMAC over a durable *inert* marker; no authenticated real effect receipt or complete power-loss recovery.

## Required security exit gates (all currently unmet)

1. **Independent trust root:** OS-managed supervisor lifecycle and explicitly documented owner/identity boundary; coordinator cannot read or replace supervisor keys, state or executable, alter policy, or impersonate an authorized writer. Root-equivalent compromise is explicitly in or out of the threat model with justification.
2. **End-to-end channel binding:** well-defined supported-kernel and namespace requirements, cryptographically or kernel-bound sender identity, session replay/delegation resistance, and elimination of unsafe old stream authority routes.
3. **Final mutation-boundary enforcement:** one supervisor-owned path verifying exact scoped operation, resource identity, approval binding, lease expiry, policy revision, one-time consumption, revocation ordering, and TOCTOU protection at the actual effect boundary.
4. **Terminal effect evidence:** durable independently authenticated terminal receipts, distinguishable attempted/prepared/applied/failed/uncertain states; a lost reply or process crash cannot cause duplicate effect by retry.
5. **Fault and adversary qualification:** real-UID boundary, same-UID attacks, inherited/delegated FDs, malicious coordinator, key/state replacement, symlink/rename, namespace, PID reuse, power cut, partial write, replay, concurrent revocation, and replay after restore/backup.
6. **Independent review:** an authorized security reviewer validates architecture, threat model, implementations, test evidence, negative cases, and deployment controls; documented signoff and explicit unblock decision occur separately from passing CI.

## CI contract

The SUP-27 adversarial regression must continue to reproduce F1 and F2. Its PASS marker is explicitly **a hold assertion**. If a future secure redesign removes these vulnerabilities, update the threat model and change the tests to require denial; do not silently delete the reproduction or reinterpret its PASS as authorization. The production-deny default and PR #1039 unmerged status are not modified by SUP-27.
