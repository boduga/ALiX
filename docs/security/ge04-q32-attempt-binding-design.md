# GE-04 Q3.2 — Attempt binding and last-effect fence (DESIGN ONLY / HOLD)

**Status:** NOT QUALIFIED. This document specifies the next adversarial gate; it does not introduce an authorization-bearing supervisor, service, trust key, or mutation API. `createScopedMutationService()` remains unavailable. Issue #1040 SECURITY HOLD persists.

## Finding motivating this gate

The operator-reported Q3.1 disposable-host experiment used distinct supervisor UID 995, coordinator UID 994 and attacker UID 993. The coordinator connected, then passed the connected socket to the attacker using `SCM_RIGHTS`. The attacker sent the forged payload, yet `SO_PEERCRED` still matched the original coordinator. The fixture replied `DENIED`. The output is operator-reported, not independently attested. This proves **connection identity is not per-message sender identity**, not that authorization is secure.

## Required authorization boundary

A connection or group membership grants only access to the *transport*. It never grants an effect. A future independently administered supervisor must verify an authorization artifact for **each** requested effect and bind it to all of:

- canonical run ID, worker ID and attempt ID (including retry generation);
- exact operation/capability and canonicalized target, with digest of effect arguments;
- trusted policy revision and approval identity, scope and expiry;
- nonce or monotonic sequence, unique for the authorization scope;
- authorized principal identity and independently verified issuance provenance;
- immutable protected release identity and the supervisor's current runtime identity.

The request's JSON fields, claimed UID/PID, or `SO_PEERCRED` are not trusted issuance evidence. A model, coordinator, or delegated socket holder must be unable to mint, rewrite, extend, or replay authorization. **No cryptographic token format is approved here:** key custody and issuer independence must be established before selecting or implementing one.

## Proposed last-effect sequence (subject to independent review)

1. Parse a bounded, canonical request; reject unknown, ambiguous or duplicated fields and ancillary FDs. Reject malformed or truncated messages without changing state.
2. Read independently protected authorization, policy revision, approval state and attempt state. Validate issuer provenance, binding fields, scope, expiry and revocation. Do not trust fields echoed by the client.
3. Recheck the *current* target and protected release/runtime identity immediately before the effect. Use descriptor-based containment rather than trusting a previously checked pathname.
4. Atomically claim the single-use authorization in durable protected state. Concurrent or repeated claims must yield at most one winner. If the claim cannot be made durably, fail closed.
5. At the final effect boundary, revalidate the claimed attempt, policy/approval status and target binding against protected state. Do not perform an effect after expiry, revocation, policy change, cancellation or target substitution.
6. Persist a durable effect-intent/effect-receipt protocol that distinguishes `not started`, `possibly applied`, and `confirmed applied` across crashes. Never assume a crash means no effect, or retry a non-idempotent effect blindly.

The ordering, durability and recovery model are **open design questions**, not validated guarantees. In particular, a claim alone is not a safe fence if authorization can change between claim and effect; a protected serialization/fencing mechanism is still required.

## Required negative-test matrix

| Case | Required result |
|---|---|
| Valid connected FD delegated to unrelated UID | No effect from connection credentials alone; reject missing independently valid per-effect authority |
| Forged approval/UID/attempt fields in payload | Reject; client claims never become authority |
| Reuse same authorization after one successful claim | Reject replay; no second effect |
| Two simultaneous claims of same authorization | At most one successful durable claim |
| Retry with changed worker/attempt generation | Reject stale binding |
| Changed capability, target, or argument digest | Reject mismatched binding |
| Policy revision changed or approval revoked/expired | Reject at last effect fence |
| Socket pathname or target symlink swapped | Reject or use verified pinned descriptor; no wrong-target effect |
| Crash before claim, after claim, before/after effect | Durable, unambiguous recovery disposition; no unsafe duplicate effect |
| Untrusted ALiX UID modifies key, policy, supervisor binary or runtime | Mutation denied by independent OS custody, not just application checks |
| Malformed, truncated, FD-ancillary or oversized frame | Deny; no state mutation or leaked received FD |
| Supervisor/issuer unavailable or protected store unreadable | Fail closed |

## Acceptance boundary

Q3.2 cannot be marked qualified until an independent operator/reviewer witnesses the real distinct-UID adversarial tests, independently controlled trust material and runtime, crash recovery, durable atomicity, and effect-time fence. Tests of a **deny-only fixture** may demonstrate rejection or expose weaknesses but cannot establish authorization safety. No release, merge, or gate transition may be inferred from a green test suite alone. Final human signoff remains mandatory.

## Q3.2 initial inert diagnostic slice

`scripts/ge04-q32-deny-validator.py` and its unit suite compare a bounded,
strict JSON request to a **test-provided expected binding**. They reject
malformed, duplicate, missing, extra, mismatched, stale-policy and replay-marked
inputs. Even an exact match returns `DENIED GE04_SECURITY_HOLD` and
`authorized=False`. This is a pure comparison, **not an authorization
implementation**: the expected binding has no protected provenance, nonce
state is not durably or atomically claimed, no authenticated issuer exists,
no current-sender identity is established, and no effect-time fence or mutation
is attempted. The tests cannot establish cross-process or cross-UID safety.

## Q3.2 disposable durable-claim experiment (not protected custody)

`scripts/ge04-q32-claim-probe.py` uses a SQLite unique nonce constraint and
`BEGIN IMMEDIATE` to test single-use claims, concurrent claim contention and
reopen-after-commit replay rejection. Its tests also check missing/corrupt-store
fail-closed behavior. The database is caller-selected and **not** independently
administered; anyone with write access can modify it. A `True` result means
only that a test nonce was inserted, **not** that a principal, attempt, approval,
policy or effect is authorized. No effect is performed. The experiment does not
prove OS-level custody, crash durability under power loss, post-claim revocation,
atomic authorization-plus-effect, recovery or delegated-FD resistance. Its
entrypoint always exits 78 and prints `DENIED GE04_SECURITY_HOLD`.

## Q3.2 read-only custody snapshot preflight (not independent custody)

`scripts/ge04-q32-custody-preflight.py` inspects an explicitly supplied
filesystem root and three fixture filenames (`policy.json`, `claims.sqlite`,
`issuer.pub`) using `lstat`. It flags wrong owners, non-private modes,
symlinks, hardlinks, missing files and a same-UID supervisor/coordinator. The
fixture names and mode requirements are **test assumptions**, not an approved
production layout. The CLI always returns exit 78 and disposition HOLD,
including when the snapshot passes. No files are created or modified.

**Limitations:** `lstat` checks are vulnerable to TOCTOU and do not validate
ancestor-directory trust, mount namespaces, bind mounts, ACLs, capabilities,
loader provenance, protected key issuance, DB integrity, or independent
administration. A compromised privileged supervisor can replace its own
files; ownership alone cannot prove issuer separation. The next acceptance
slice needs an independent operator-controlled root, descriptor-pinned path
walk and actual untrusted-UID negative write tests. A passing snapshot cannot
be used as a trust decision or to clear the GE-04 HOLD.

## Q3.2 distinct-UID negative-write host probe (operator-reported execution)

`scripts/ge04-q32-negative-write.py` is an **opt-in disposable Linux host**
probe. A root-launched, independently operated test process creates three
synthetic supervisor-owned files in a temporary `0700` directory, with `0600`
file modes. It drops to the separately provisioned coordinator and attacker
UIDs and attempts overwrite, unlink, rename, and create operations. It checks
that both identities were denied and the original synthetic files remained
unchanged. A successful probe exits zero only for **negative-write experiment
completion**; its JSON always says `disposition: HOLD` and
`qualified_independent_custody: false`. Its CI tests only verify fail-closed
prerequisites, **not** cross-UID enforcement.

Operator-only disposable host invocation (after copying the script to a
root-owned, non-writable test directory):

```sh
sudo python3 -B /opt/alix-ge04-q31-test/ge04-q32-negative-write.py \
  --isolated-test --supervisor alixge04supervisor \
  --coordinator alixge04coordinator --attacker alixge04attacker \
  --group alixge04transport
```

Do not use real policy, keys, or protected runtime paths. The probe only tests
basic DAC on temporary synthetic files; it does not establish independence,
protected issuance, path-race resistance, mount/ACL integrity, or actual
production supervisor custody. The GE-04 SECURITY HOLD remains active.

## Operator-reported disposable-host negative-write result

The operator supplied JSON for `GE04_Q32_NEGATIVE_WRITE` reporting supervisor
UID 995, coordinator UID 994 and attacker UID 993. Both non-supervisor UIDs
reported `DENIED` for each of ten operations: overwrite, rename and unlink
for each of `claims.sqlite`, `issuer.pub` and `policy.json`, plus directory
entry creation. Totals: **20/20 attempted writes denied**,
`synthetic_fixtures_unchanged: true`, `negative_writes_denied: true`,
`disposition: HOLD`, and `qualified_independent_custody: false`.

This is **operator-reported evidence**, not independently witnessed, attested
or reproduced by the reviewer. It demonstrates reported Linux DAC denial on
temporary synthetic files only. It does not prove protected issuer custody,
ancestor/mount integrity, release provenance, post-check race resistance,
last-effect authorization, crash recovery or independent administration.
No gate status changes: **GE-04 SECURITY HOLD remains active**.

## Q3.2 pathname substitution / pinned-descriptor diagnostic

`scripts/ge04-q32-path-race-probe.py` performs an unprivileged, synthetic
pathname substitution experiment. It opens an original file through a pinned
directory FD, then replaces its pathname with a symlink to different content.
A naïve pathname reopen follows the symlink, while `pread` on the already-open
file FD still reads the original content. `O_NOFOLLOW` rejects the symlink at
the final path component, **but does not reject a replacement regular file**:
the probe separately demonstrates that weakness. The CLI always exits 78 and
reports `HOLD`, even when all observations match expectations.

This is a controlled sequence, **not** a concurrent race proof, `openat2`
qualification, immutable target binding, protected root verification, or an
authorization/effect fence. An attacker able to mutate the directory may still
substitute regular files; the effect boundary must verify protected identity
and containment against a pinned descriptor and trusted policy, and must
address races and mount/ancestor substitution. No mutation service is enabled.

## Q3.2 descriptor target identity diagnostic

`scripts/ge04-q32-descriptor-target-probe.py` compares `(st_dev, st_ino,
file type)` of a file opened relative to a pinned directory descriptor against
a previously captured synthetic identity. Its five tests show an initial
match, detection of regular-file replacement, continued access to the original
file through an already-open descriptor, and rejection of final-component
symlinks and simple `../` traversal. It performs no authorized effects and
always exits 78 with `HOLD`.

**This is not a secure resolver or last-effect fence.** The trusted root and
expected identity are test-provided, not independently verified. Inode identity
is not a content digest or authorization binding and can be reused after close;
filesystem metadata may be changed by a privileged attacker. Multi-component
paths, mount replacement, ACLs, file mutation through other descriptors,
concurrent races, issuer custody, policy revocation, and crash behavior remain
unqualified. Production code must not reuse this as an authorization check.

## Q3.2 synthetic revocation-ordering diagnostic

`scripts/ge04-q32-revocation-probe.py` exercises a disposable SQLite state row
and nonce table. `BEGIN IMMEDIATE` serializes a diagnostic revision/active
check with a synthetic nonce insertion, and separately serializes revocation.
The tests cover stale revision, revoke-before-check, replay, concurrent
revoke/check and missing storage. Every diagnostic result has
`authorized: false`; the executable always exits 78 with `HOLD`.

**Not an effect-time fence:** neither the state row nor the caller-provided
revision has independent provenance; there is no trusted issuer, approval
scope, expiry, effect or protected storage. The check transaction ends before
any possible effect, so revocation *after* the check is not fenced. SQLite
serialization only orders these synthetic database operations. A real last-
effect fence needs an independently protected authority and a carefully
specified synchronization/revocation protocol spanning the effect boundary,
plus crash and recovery evidence. No gate transition is justified.

## Q3.2 independently administered issuer boundary — proposed contract, not qualified

**Trust separation:** The operator (not ALiX) must provision and control an
issuer identity, a supervisor identity, and separately untrusted coordinator
and attacker identities. An issuer controlled by the coordinator, the model,
or the effect-executing supervisor is not independent for this gate. A distinct
UID is necessary for the proposed Linux deployment, but **not sufficient**:
operator control of service definitions, runtime binary, mount namespace,
parent directories, privileges, key material, backups, logs and updates must
also be evidenced. Root/host administrators remain in the trusted computing
base. Avoid an argument-unrestricted sudoers delegation for any untrusted UID.

**Authority flow (proposed, not implemented):**

1. The independent issuer observes a trusted approval, policy revision and
   live attempt state from independently protected sources; it must not treat
   coordinator JSON, a socket peer UID or a previously approved bearer token
   as sufficient proof.
2. The issuer may produce a *single-effect* authorization record scoped to the
   exact attempt/generation, principal, capability, canonical target, argument
   digest, protected release, expiry and unique nonce. Token syntax, key type
   and signing strategy remain undecided pending custody review.
3. The supervisor independently retrieves/verifies the issuer record and
   current policy/approval/attempt state. Mere possession of a delegated
   socket **or transferable authorization artifact** must not grant a second
   principal authority. The design must explicitly define how the intended
   principal is authenticated per effect and whether delegation is permitted.
4. The supervisor must atomically claim single use in protected custody and
   perform an effect-time check under a specified synchronization/fencing
   protocol. A DB transaction committed before an effect does **not** fence
   revocation between the check and effect. Crash intent/receipt recovery
   and the semantics of concurrent revocation must be reviewed independently.

**Evidence still required:** independently witnessed effective UID/GID and
privilege inspection; ownership/mode/ACL/mount/ancestor verification; denied
write/rename/link/replace attempts against issuer material and service files;
failed forged issuance and stolen/delegated artifact attempts; expiry,
revocation, replay and concurrent claim negatives; a protected target and
last-effect protocol; restart/crash recovery; and explicit human signoff.

`ge04-q32-issuer-boundary.py` is only a *synthetic configuration lint*: its
caller supplies all identity and mode facts, so they are not authenticated
observations. Nine tests demonstrate mismatch rejection. Even fully matching
facts return `qualified_independent_issuance: false` and `HOLD`. No key,
credential format, issuer service, policy read or mutation authority exists.

## Q3.2 disposable-host issuer-owned negative-write probe (operator-reported execution)

`scripts/ge04-q32-issuer-negative-write.py` is an opt-in, root-launched,
**disposable-host-only** experiment. It requires four independently provisioned
nonroot UIDs (`issuer`, `supervisor`, `coordinator`, `attacker`), creates only
synthetic issuer-owned files inside a temporary issuer-owned `0700` directory,
and drops to each other UID for thirteen negative-write attempts (overwrite,
unlink, rename, chmod, hardlink and symlink replacement on two files, plus
creation). It checks original content, inode, ownership and mode afterward.
No actual signing material, issuer service or protected policy is involved.

After separately provisioning an `alixge04issuer` nonroot user on the isolated
host, copying the script into a root-owned non-writable staging directory,
and reviewing the script, the operator may run:

```sh
sudo python3 -B /opt/alix-ge04-q31-test/ge04-q32-issuer-negative-write.py \
  --isolated-test --issuer alixge04issuer \
  --supervisor alixge04supervisor --coordinator alixge04coordinator \
  --attacker alixge04attacker
```

An exit 0 means only that the synthetic negative-write experiment observed
all denials and unchanged files; the JSON **always** states `HOLD` and
`qualified_independent_issuance: false`. The four nonprivileged tests cover
only fail-closed prerequisites; they are not privileged host evidence. This
experiment does not inspect real service privileges, ACLs, mount namespaces,
ancestor trust, sudo policy, privileged compromise or protected issuance.

## Operator-reported four-UID issuer negative-write evidence

The operator supplied JSON for `GE04_Q32_ISSUER_NEGATIVE_WRITE` reporting
issuer UID **990**, supervisor UID **995**, coordinator UID **994**, and attacker
UID **993**. Each non-issuer identity reported `DENIED` for thirteen attempts:
overwrite, unlink, rename, chmod, hardlink, and symlink replacement against
each of `issuer.synthetic` and `policy.synthetic`, plus a create attempt.
Total: **39/39 denied**. The result reports
`synthetic_fixtures_unchanged: true`, `negative_writes_denied: true`,
`disposition: HOLD`, and `qualified_independent_issuance: false`.

**Provenance:** operator-provided JSON, not independently witnessed,
attested, or reproduced by the reviewer. It demonstrates reported denial of
filesystem writes by three distinct non-issuer UIDs against disposable
issuer-owned synthetic fixtures. It does not establish protected signing-key
custody, trusted approval ingestion, issuer runtime integrity, independent
administration, privileged-actor resistance, ACL/mount/ancestor integrity,
credential anti-delegation, or an effect-time revocation fence.

**Gate disposition remains GE-04 SECURITY HOLD.**
