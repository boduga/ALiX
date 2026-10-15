# ALiX Option B — Secure Remote Approval Protocol (SRAP)

> **Dated hand-off record (`docs/AGENTS.md`), not a live contract.** This is the
> target-state design vision; the live rules are in the owning `AGENTS.md` files
> and ADR-0015.

**Status:** Proposed architecture and implementation plan — not yet implemented  
**Target:** Existing TypeScript ALiX, distributed-ready, always-on daemon  
**Primary use case:** Approve bounded agent actions from a trusted phone using passkeys with local biometric/PIN verification.

## 1. Non-negotiable invariants

1. Agents may request authorization but cannot approve their own actions or modify approval evidence.
2. The executor—not the agent, UI, or notification service—must validate authorization immediately before performing the exact action.
3. A grant is scoped to one immutable action digest, principal, target, environment, policy version, and optional target-state precondition.
4. Every challenge is random, expires quickly, is single-use, and is consumed atomically with execution authorization.
5. No fingerprint or facial template is transmitted to or stored by ALiX. A platform authenticator verifies the person locally; the server verifies a signed WebAuthn assertion and user-verification flag.
6. Approval never overrides an explicit policy prohibition. Sensitive governance changes require an independent administrative pathway.
7. Lost connectivity, invalid signatures, changed action parameters, expired requests, revoked devices, or missing verification cause denial, not implicit consent.
8. Approval decisions and execution outcomes are independently auditable, with secrets and biometric data excluded.
9. Only an authenticated operator with an appropriate role can approve; device possession alone is insufficient.
10. Every worker, including remote workers, must pass through the same central execution authorization boundary.

## 2. Trust boundaries

- **Untrusted reasoning plane:** models, agents, plans, prompts, retrieved content, worker suggestions.
- **Trusted control plane:** governance decision service, approval challenge service, credential registry, policy evaluation, execution authorization.
- **Execution plane:** tool adapters, Incus sandbox, repository/host operations. Must enforce signed/opaque grants with authoritative server-side verification.
- **Presentation plane:** TUI, web, mobile, notifications. Displays requests; never serves as the source of approval truth.
- **Device authenticator:** platform passkey / hardware security key, private key remains protected by authenticator.

## 3. Request lifecycle

1. Agent proposes a tool action; normalize the operation into a canonical, versioned action envelope.
2. Governance checks policy and risk. Denied actions terminate; preauthorized actions proceed within existing delegated scope; approval-required actions are paused.
3. Create a pending approval record with cryptographically random challenge, immutable action digest, audience, expiry, risk, approver constraints, and expected target version.
4. Send a minimal push notification; authenticated operator opens the full request and evidence.
5. Operator reviews exact target, parameters, expected effects, rollback plan, and expiry.
6. WebAuthn challenge is issued for the authenticated operator session. Validate origin, RP ID, challenge, signature, credential ownership, user verification, and credential status. Bind the challenge server-side to the approval record and action digest.
7. Record explicit approve/deny intent associated with the verified assertion. For high-risk actions, use transaction-detail confirmation in the trusted application; do not claim ordinary WebAuthn alone displays transaction details on the authenticator.
8. Atomically transition `pending -> approved/denied/expired`, with replay and concurrent-approval protection.
9. Immediately before execution, recheck current policy, credential/approver eligibility, action digest, target-state preconditions, scope, TTL, and single-use status; atomically claim the authorization.
10. Execute exactly the approved action; log outcome and notify operator. Failure or changed preconditions requires a fresh authorization.

### State machine

`proposed -> policy_checked -> pending -> approved -> claimed -> executing -> succeeded|failed`

Alternate terminal transitions: `denied`, `expired`, `revoked`, `cancelled`, `invalidated`. Use monotonic transition checks and compare-and-swap/versioned updates; recovery must not reuse a claimed grant.

## 4. Proposed contracts (illustrative, align to repository schemas during implementation)

```ts
type ApprovalRequest = {
  id: string;
  runId: string;
  actionId: string;
  actionSchemaVersion: number;
  actionDigest: string; // SHA-256 of canonical action envelope
  actionSummary: string; // safe human-readable rendering
  target: string;
  environment: 'sandbox' | 'development' | 'production';
  risk: 'moderate' | 'high' | 'critical';
  policyVersion: string;
  targetStateVersion?: string;
  requiredApproverRole: string;
  requiredFactors: 'verified_passkey' | 'passkey_plus_independent_factor' | 'two_person';
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked' | 'claimed' | 'executing' | 'succeeded' | 'failed';
  version: number;
};

type ApprovalDecisionEvidence = {
  requestId: string;
  approverPrincipalId: string;
  credentialIdHash: string;
  authenticatorUserVerified: boolean;
  verifiedAt: string;
  decision: 'approve' | 'deny';
  challengeId: string;
  actionDigest: string;
  verificationMethod: 'webauthn';
};
```

Never accept `actionDigest`, `approverPrincipalId`, or verification status solely from client input; derive/verify them server-side. Prefer opaque server-stored execution grants over bearer tokens. If signed grants are necessary across nodes, include audience, expiry, nonce, scope and key rotation, with server-side replay tracking.

## 5. WebAuthn and enrollment

- Enroll an operator from an already-authenticated, privileged session using a fresh enrollment challenge.
- Use HTTPS and a stable relying-party domain; localhost may be used for development under browser-specific secure-context rules.
- Store credential public key, credential ID, principal, authenticator metadata as appropriate, enrollment time, and revocation state; protect credential identifiers and minimize retained metadata.
- Require user verification for sensitive approvals; reject assertions that do not meet required flags.
- Maintain at least two independent recovery paths: second passkey/hardware key and carefully controlled offline recovery procedure.
- Distinguish synced passkeys from device-bound credentials. A synced passkey proves control of the credential, not necessarily possession of one particular phone; require separate device enrollment/attestation only when justified and supported.
- For critical operations, enforce a separate hardware-backed credential or second authorized human, not two prompts on the same phone presented as independent factors.
- Rate-limit requests and verification attempts; require reauthentication for credential registration/revocation.

## 6. API surface (proposed)

- `GET /api/approvals?status=pending` — authenticated operator view, scoped by role.
- `GET /api/approvals/:id` — immutable details and evidence summary.
- `POST /api/approvals/:id/webauthn/options` — issue one-time bound challenge.
- `POST /api/approvals/:id/decision` — verify assertion and record explicit intent.
- `POST /api/approvals/:id/cancel` — authorized cancellation.
- `GET /api/devices` — list enrolled credentials/devices.
- `POST /api/devices/enrollment/options` and `POST /api/devices/enrollment/verify` — enrollment.
- `POST /api/devices/:id/revoke` — protected revocation.

Prefer existing ALiX API and event conventions over these example routes if equivalents already exist. Keep all mutating routes CSRF-resistant, origin-validated, authenticated, authorized, rate-limited, and audit logged.

## 7. Threat model and mitigations

| Threat | Control |
|---|---|
| Agent forges approval | Independent governance and server-side WebAuthn verification |
| Prompt injection | Treat all model/retrieved content as untrusted; executor enforces policy |
| Replay of approved action | Unique challenge, atomic single-use claim, TTL |
| Action substitution | Canonical action digest and target-state recheck |
| Stolen phone | Local user verification, credential revocation, short expiry |
| Synced credential mistaken for device identity | Separate credential identity from device trust claims |
| Malicious push notification | No approval from notification itself; open trusted app to review |
| Phishing | Correct RP ID/origin validation; passkey-based authentication |
| Compromised worker | Worker cannot mint grants; central authorization and scoped credentials |
| Compromised coordinator | Defense in depth with OS isolation, audit export, restricted admin access, and external recovery controls |
| Operator unavailable | Timeout and deny; only previously authorized low-risk actions may continue |
| Governance tampering | Separate administrative control, independent factor, and tamper-evident audit |

## 8. Relationship to Option B

- **Always-on daemon:** manages pending requests, expiry, resumption, and durable checkpoints.
- **AFK agent:** pauses at authorization boundary without blocking unrelated safe work.
- **Web UI:** first delivery path for secure passkey approval; mobile-responsive PWA can precede native app.
- **Mobile:** later native client with push notification, local biometric gate, and passkey flow.
- **Wake word:** voice may propose actions but must never substitute for high-risk cryptographic approval.
- **Distributed workers:** central coordinator issues narrowly scoped work, execution gateway verifies grants.
- **Rust:** not needed for WebAuthn correctness; consider Rust only for benchmarked hot paths, low-overhead voice listener, or isolated executor.

## 9. Implementation phases and acceptance gates

### Phase 0 — Repository contract audit
- Locate existing governance decision, approval persistence, execution gate, event journal, authentication, and CLI/TUI surfaces.
- Map authority ownership and current approval state transitions.
- Confirm existing tests and extension seams; do not duplicate authorities.
- Deliver a gap matrix and API/schema change proposal.

### Phase 1 — Server-side immutable approval contract
- Canonical action envelope/digest; request persistence; state transitions; expiry; atomic claim.
- Executor validates approved scope immediately before execution.
- Tests: replay, concurrency, changed action, changed target state, restart recovery, expiry, cancellation, denial.

### Phase 2 — WebAuthn and operator enrollment
- Passkey registration, authentication, user verification, device/credential revocation, recovery plan.
- Tests: invalid origin/RP, wrong challenge, wrong principal, stale assertion, revoked credential, missing UV, CSRF, rate limits.

### Phase 3 — Phone-accessible web approval
- Mobile-responsive approval inbox, full diff/action preview, evidence, explicit approve/deny, audit timeline.
- Push notifications contain no secret and never authorize an action.
- Tests: mobile usability, accessibility, reconnects, duplicate notifications, session expiry.

### Phase 4 — AFK and distributed integration
- Pause/resume coordination runs; preserve immutable work plan; propagate state across restarts.
- Remote workers use centralized execution authorization.
- End-to-end: agent requests -> phone approves -> exact tool executes once -> evidence appears in Workbench.

### Phase 5 — Native mobile and critical approvals
- Native push, passkeys, biometric prompts, credential/device management.
- Independent hardware key or second-person approval for critical operations.
- Security review and operational recovery drills.

## 10. Definition of done

A representative production-like action cannot execute without valid authority; an operator can inspect it on a phone, approve using a user-verified passkey, and see the exact result. All denial, timeout, tampering, replay, concurrency, lost-device, restart, and remote-worker cases fail safely. Existing ALiX governance tests remain green; no parallel approval authority is introduced.

## 11. Explicit non-goals for first release

- No collection or storage of biometric templates.
- No voice-only approval for sensitive actions.
- No unrestricted autonomous privilege escalation.
- No mandatory Rust rewrite.
- No native mobile application prerequisite.
- No claim of true device binding from a synced passkey alone.

## 12. Next  task

> Audit the current ALiX repository for governance, approval lifecycle, execution authorization, session persistence, API authentication, and Workbench approval presentation. Compare existing contracts against `2026-10-14-srap-option-b-design.md`. Produce a source-cited gap matrix and a minimal Phase 1 implementation plan. Do not modify production code or create a second governance authority. Identify schema compatibility, migration, test requirements, and any unsafe assumptions before coding.
