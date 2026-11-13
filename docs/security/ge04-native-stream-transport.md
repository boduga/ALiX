# GE-04 native byte-stream transport increment

The operator selected Linux AF_UNIX SOCK_STREAM. This library replaces neither
the production supervisor nor broker. GE-04 SECURITY HOLD remains active.

`native/ge04/worker-stream.c` accepts the actual native socket and authenticates
the connection plus each recvmsg fragment. A retained pidfd and bracketed procfs
identity reads bind expected PID/UID/GID/starttime. The peer must have matching
real/effective/saved/fs IDs, no supplementary groups, zero effective/permitted/
inheritable/ambient capabilities and no_new_privs. These checks assume trusted
procfs/PID namespace and registration custody. A PID supplied by argv is not
independent launch or attempt authorization.

Wire format: ASCII `ALX1`, a network-order 32-bit length, then 1..65536 opaque
nonsecret bytes. Header and body share one read deadline. Coalesced frames are
read separately. SO_PASSCRED is enabled before traffic; every received fragment
needs exactly one matching SCM_CREDENTIALS. Descriptor transfer, unknown or
truncated ancillary data denies. Received SCM_RIGHTS/SCM_PIDFD descriptors are
closed before denial; truncation is recorded diagnostically.

The header documents the caller-facing API and ownership. Fresh sessions alone
can accept; only open sessions can read/write. Any error or timeout closes the
owned socket/pidfd and poisons the session. Borrowed listener and cancellation
pipe stay caller-owned; destruction is idempotent. Cancellation, process exit
and socket error take precedence over ordinary readiness. The listener must
already be nonblocking, exclusive, AF_UNIX stream, listening and PASSCRED-enabled.
Individual IPC budgets are 100..5000ms, not a total worker lifetime limit.

Senders may intentionally delegate response-reading descriptors. Sender checks
cannot attest the eventual reader, prevent a worker sharing already available
data, or fence a broker effect atomically with revocation. No credentials,
provider access or reusable authority are delivered by this transport.

## Verification and privileged scope

```sh
python3 -m unittest discover -s tests/agents -p test_ge04_native_stream.py -v
```

The unprivileged run compiles with `-Wall -Wextra -Werror -O2` and checks malformed
arguments and unprivileged refusal. Skipped cross-UID tests are not qualification.

Only after independent native source review, use the designated disposable VM
and a new isolated source workspace, with recorded source hashes:

```sh
sudo -n env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C \
 ALIX_GE04_PRIVILEGED_QUALIFICATION=1 ALIX_GE04_TEST_WORKER_UID=20002 \
 /usr/bin/timeout --signal=TERM --kill-after=5s 90s /usr/bin/python3 \
 -m unittest discover -s tests/agents -p test_ge04_native_stream.py -v
```

UID/GID20002 must be unused and distinct from the witness. The controller creates
only fresh root-owned `/run/ge04-stream-test-*` directories (0711), ephemeral
root-owned socket inodes (0666) and a private build directory. Public socket
permissions are solely for synthetic cross-UID reachability; this is not a
production deployment pattern. The native harness never launches or signals a
process; the Python controller only creates/reaps its synthetic children. Never
install the harness setuid, as a public privileged service or as a sudo target.

The suite covers framing, coalescing, delegated/mixed senders, descriptor
rejection/cleanup, identity mismatch, cancellation, peer exit and IPC timeouts.
Backpressure uses an explicitly small send buffer and bounded 64KiB reply.
Cancellation/exit during the write phase is distinct from proving exactly which
byte was last delivered. A failed write may already have delivered partial bytes.
Malformed/uninjectable kernel ancillary branches are source-reviewed rather
than claimed as live test coverage. Actual PID reuse is not forced; stale
starttime and retained-pidfd exit are necessary partial checks only.

Record each result/skip, exact command and source hashes, raw failures, labeled
cleanup counts and witness identity before/after. Agent review is engineering
review and supplies no independent human release signature.

## Remaining B2 and later gates

This increment supplies no durable native registration service, task-aware
backend, cgroup descendant containment, constrained filesystem/network, full
hostile secret-store/keyring/high-FD denial or recovery authority. Existing
production worker entries remain unavailable. B2 completion precedes C's
broker-owned inference, D's durable final-effect authorization, E's consumer
migration/deletion and F's independent security release decision.

The API assumptions were checked against the primary
[Linux UNIX socket manual](https://man7.org/linux/man-pages/man7/unix.7.html) and
[pidfd manual](https://man7.org/linux/man-pages/man2/pidfd_open.2.html).
Kernel sender-boundary behavior still needs the designated-kernel live tests.
