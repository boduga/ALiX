# GE-04 Q3.2 — Runtime privilege and delegation review

**Status: SECURITY HOLD. Evidence request only; not an authorization gate.**

## Observation so far

On `microcloud3`, a read-only `systemctl list-unit-files '*alix*'`
returned no ALiX-named unit files. This does **not** establish that no
service exists under another name, that no process runs, or that the host is
secure. Prior probes exercised synthetic files and unprivileged process
snapshots, not an independently administered issuer runtime.

## Operator-reviewed evidence collection (disposable host only)

Run these read-only commands locally on `microcloud3`, inspect output for
sensitive paths or service environment values, and share only redacted
observations. Do not print environment variables, private keys, tokens,
credentials, or full privileged configuration files.

```sh
# Exact account and group resolution
getent passwd alixge04issuer alixge04supervisor alixge04coordinator alixge04attacker
id alixge04issuer
id alixge04supervisor
id alixge04coordinator
id alixge04attacker

# Running processes (not proof of their parent/launcher integrity)
ps -eo pid,ppid,uid,gid,comm --sort=pid

# Unit names only; then inspect specifically identified relevant units
systemctl list-units --all --type=service --no-pager
systemctl list-unit-files --type=service --no-pager

# Filesystem and mount context; choose explicit, nonsecret directories
findmnt -T /opt/alix-ge04-q31-test -o TARGET,SOURCE,FSTYPE,OPTIONS
namei -l /opt/alix-ge04-q31-test
```

For each **actual** issuer/supervisor service, independently review
`systemctl show UNIT --property=User,Group,SupplementaryGroups,DynamicUser,NoNewPrivileges,CapabilityBoundingSet,AmbientCapabilities,ProtectSystem,ProtectHome,PrivateTmp,ReadWritePaths,ExecStart`.
`ExecStart` may reveal sensitive arguments: redact before sharing. Check
whether service binaries, their ancestors, unit definitions and drop-ins are
writable by coordinator or attacker. Check service credential loading and
whether privileges change after startup. An inactive or nonexistent unit is
**unqualified**, not a passing security boundary.

For sudo delegation, a trusted operator must inspect **effective** sudoers
policy for each test identity (including includes, groups and command
arguments). A noninteractive negative check alone cannot prove that no
privilege path exists; sudoers, polkit, setuid executables, Linux capabilities,
service manager APIs and inherited file descriptors also matter. Do not grant
any additional privilege to perform this review.

## Evidence classification

| Requirement | Present evidence | Status |
|---|---|---|
| Four nonroot test identities | Operator host snapshot | Observed, limited |
| Synthetic issuer file isolation | 39/39 negative writes reported denied | Observed, limited |
| Real issuer service identity and launcher | No identified service | Missing |
| Protected issuer binary, unit and credential custody | None | Missing |
| Sudo/polkit/setuid and capability escalation exclusion | None | Missing |
| ACL, mount namespace and ancestor trust | None | Missing |
| Authenticated nondelegable effect request | None | Missing |
| Effect-time revocation and crash protocol | None | Missing |
| Independent reviewer and human acceptance | None | Missing |

**Decision: HOLD.** Do not instantiate production keys, trust a diagnostic
match as authorization, enable `createScopedMutationService()`, or promote
synthetic observations into independent qualification.

## Experimental deny-only issuer process (not installed as a service)

`scripts/ge04-q32-deny-issuer-service.py` is a bounded, opt-in, Linux-only
`SOCK_SEQPACKET` listener. It requires a nonroot effective UID and a private
`0700` directory owned by that UID, creates a mode `0600` socket, reads at most
4097 bytes per connection, and always responds with the fixed text
`DENIED GE04_SECURITY_HOLD`. It does not parse requests into authority,
create signing material, use an approval store, or perform effects. It exits
78 / `HOLD` even after a successful diagnostic. Five unprivileged tests cover
fail-closed prerequisites and an attempted forged approval message.

The script is **not** a persistent issuer, service unit, or production
security boundary. The next host test must run it under the already-created
`alixge04issuer` UID using an operator-reviewed, bounded disposable invocation,
then separately observe actual process credentials and attempted connections
from coordinator, supervisor and attacker. Do not install a long-lived unit,
change sudoers, or lift the hold on the basis of this experiment.

## Bounded cross-UID listener experiment (operator-reported result)

`scripts/ge04-q32-issuer-cross-uid.py` is a **root-launched**, explicit
`--isolated-test` orchestration of the previously tested deny-only listener.
It uses four distinct nonroot accounts, a disposable root-owned traversal-only
parent and issuer-owned `0700` child, starts the listener as the issuer UID,
then attempts three cross-UID connections and one issuer-UID forged-approval
message. Expected results: supervisor, coordinator and attacker receive OS
permission denial; the issuer connection receives the fixed `DENIED` reply.
It checks bounded listener termination and cleans temporary paths. Even a
passing run returns JSON `disposition: HOLD` and
`qualified_independent_issuance: false`; exit 0 signifies **only** the
synthetic experiment passed. No credentials or production service are created.

After reviewing both staged scripts, the operator may run **only on the
isolated disposable host**:

```sh
sudo python3 -B /opt/alix-ge04-q31-test/ge04-q32-issuer-cross-uid.py \
  --isolated-test --issuer alixge04issuer \
  --supervisor alixge04supervisor --coordinator alixge04coordinator \
  --attacker alixge04attacker
```

This is not evidence of sudo/polkit confinement, trusted issuer code,
independent administration, delegated-FD protection, real credential custody,
or effect-time authorization. Do not run against production paths.

### Cross-UID execution evidence — operator-reported

The operator supplied `GE04_Q32_ISSUER_CROSS_UID` JSON after installing the
missing deny-only listener alongside the runner on `microcloud3`. It reports
three denied cross-UID connections (`attacker` UID 993, `coordinator` UID 994,
`supervisor` UID 995; each exit code 13), and a successful issuer-UID 990
connection that received the fixed denial (`issuer_denial_received: true`).
The listener exited 78 and the result reported
`negative_connects_denied: true`, `disposition: HOLD`, and
`qualified_independent_issuance: false`.

**Provenance:** operator-provided output, not independently attested. This
validates the tested mode-0600 socket and issuer-owned private directory
under the test conditions, **not** an independent issuer authority, an
authorization protocol, sudo/polkit boundaries, FD delegation safety,
protected credentials, or effect-time checks. GE-04 SECURITY HOLD remains.

## Connected-descriptor delegation adversarial test (operator run pending)

`scripts/ge04-q32-issuer-fd-delegation.py` is an opt-in, root-launched,
**disposable-host-only** experiment. It launches the fixed-denial issuer
listener as the issuer UID, connects to the private socket as that UID,
passes the *already connected* descriptor to a distinct attacker UID using
`SCM_RIGHTS`, and sends a forged approval over the delegated descriptor.
A passing test requires the attacker to receive `DENIED GE04_SECURITY_HOLD`;
JSON always reports `HOLD` and `qualified_independent_issuance: false`.
The experiment is not evidence that a real authorization service can detect
who subsequently holds a delegated connection. `SO_PEERCRED` ordinarily
reflects the original connector, not the later holder of the FD. A
credential-based allow decision on that descriptor would therefore be unsafe.

After reviewing both scripts, the operator may run on **microcloud3 only**:

```sh
sudo install -o root -g root -m 644 \
  ~/ge04-q31-staging/ge04-q32-issuer-fd-delegation.py \
  /opt/alix-ge04-q31-test/
sudo python3 -B /opt/alix-ge04-q31-test/ge04-q32-issuer-fd-delegation.py \
  --isolated-test --issuer alixge04issuer --attacker alixge04attacker
```

The companion `ge04-q32-deny-issuer-service.py` must already be installed
beside the runner. This is no authority-bearing issuer, key or effect test.
