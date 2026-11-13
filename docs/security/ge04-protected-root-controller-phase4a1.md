# GE-04 Protected Root Controller — Phase 4A1 keeper process identity

**SOURCE CANDIDATE ONLY · ALL R1-B1 GATES OPEN · GE-04 SECURITY HOLD ACTIVE.**

This increment adds production-intended
`native/ge04/protected-keeper-custody.[ch]`. It is NOT linked to an
activated privileged controller. The original controller main continues
to return 77 and StartTransientUnit continues to refuse with EPERM.

## Keeper process identity boundary

`ge04_keeper_pin_unqualified` requires root identity, the held original
journal/attempt and an existing systemd transaction. It calls the
read-only Phase 3B3A post-job observer first: an exact fixed unit, same
manager, job correlation and stable PID/invocation must be present.
It samples bounded /proc/PID/stat and /proc/PID/cgroup, requiring the
exact `0::/system.slice/ge04-r1b2-view-qualification.service` line.
It extracts the unsigned 64-bit startticks from proc stat field 22,
handling parentheses inside process comm and rejecting malformed or
overflowing tokens. The source opens the actual Linux pidfd with
`pidfd_open(pid, 0)`, refuses exited descriptors, and resamples the
same PID/startticks/cgroup identity before retaining the pidfd. It
rechecks original manager/attempt/journal custody before accepting the
held process. Recheck compares the same original process generation
and exact cgroup, bracketed by pidfd liveness. Close releases the
owned pidfd only and resets fields without mutating the process.

No process is launched, signaled, killed, reparented or adopted. No
cgroup controls, systemd mutation, worker registration, root staging
or phase ACK are performed. The held process observation is always
**unqualified**, even if the PID, start ticks and service invocation
appear consistent. No caller can use the result as an authorization.

## Critically incomplete custody

A pidfd opened after systemd reports an active unit **does not prove**
ALiX exclusively created that unit or held the keeper since its
original birth. Original launch provenance, kernel PID generation at
creation, authenticated file installation and service identity, pidfd
acquisition within the protected creation lifetime, cgroup2 mount
identity, mount namespace/superblock, and original root/system.slice/
unit directory FDs are still unimplemented. Root-only APIs have not
been exercised with root; source-level qualification is not runtime
trust. Process-wide timeouts and crash-safe recovery remain open.

The next increment should pin the cgroup2 mount and full fixed
ancestry through no-follow/openat2 directory descriptors, verify
exact mount ID/root and cgroup membership against original boot
identity, and retain descriptors through the transaction. It must
not infer original kernel custody from today's cgroup existence.

## Verification scope

Unprivileged tests compile the real native C component and exercise
bounded procfs sampling of the test process, valid starttick parsing,
changed PID rejection, malformed/incomplete proc data, wrong cgroup
refusal, unprivileged pin/recheck refusal, and non-owned descriptor
cleanup. No root, systemd unit creation or ACK was invoked.

External independent human review, immutable root-only staging,
approved disposable-VM adversarial qualification and Q13 acceptance
remain mandatory before changing security hold.

## Provisional Phase 4A1 source fingerprints — not approval

| File | Source SHA-256 |
| --- | --- |
| `native/ge04/protected-keeper-custody.c` | `1bf541f587e9f417f833acfce257537bb45c015ff62195e4cce933f329f779dc` |
| `native/ge04/protected-keeper-custody.h` | `8ccb045c0c33fd1231f4543d08d47783a58bbd05790ac6d131e2f3b3df99bb4b` |

These source fingerprints are editable candidate hashes, NOT independently
approved source, frozen binaries, kernel ownership or VM/Q13 clearance.
