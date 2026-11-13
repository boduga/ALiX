# R1-B2 native stream synthetic observation — 2026-11-09 UTC

GE-04 SECURITY HOLD ACTIVE. Agent-executed engineering evidence only; not B2 completion, independent human security qualification or release approval.

## Source and host provenance

The operator selected SOCK_STREAM. Readiness/design reviews completed with corrections before implementation. Two independent source reviews examined the actual native library/header, harness, Python controller and contracts before root execution. The no-connect assertion and subprocess-buffering findings were fixed and re-reviewed. Native C remained unchanged after source review. GCC warnings and static analyzer were clean locally. No production TS consumer or task backend is wired to the library.

Base `0ac610820b4b0b85e7625495b20340ca024f6b51` plus exact reviewed new files, copied alone into a new isolated VM workspace `/home/ubuntu/alix-ge04-workspaces/0ac61082-stream-01`. Local and remote SHA256 matched before invocation:

- `d083be27f291886cc08b203ca21f64ad9caa70e294a9d5d6bd9f82784e70faf3` — `native/ge04/worker-stream.c`
- `7d8cb2749535d47fe5f3898107e7638a2036f7153c6cefda99081b22de7466f8` — `native/ge04/worker-stream.h`
- `3a58620570643ce23397580128e58c5ba436ce8eb487e642405e26b94af78041` — `tests/fixtures/ge04-native-stream-probe.c`
- `fc83c2ad71986743a34a91dade3f732bf1591defb2367af5d7d9e0c4043d9327` — `tests/agents/test_ge04_native_stream.py`

Designated VM `ubuntu@10.1.1.13`, alix-ge04-qual-01, Ubuntu 26.04.1 LTS, Linux 7.0.0-43-generic x86_64, Python 3.14.4, GCC 15.2.0. Root source/commands remained the reviewed synthetic scope. No accounts, services, sudoers, cgroups or namespaces were modified. No real credentials, provider calls, production broker admission or scoped mutation service were used by this suite. Socket mode 0666 and parent 0711 are synthetic reachability fixtures, not an approved public deployment.

## Invocation

From the isolated workspace:

```sh
sudo -n env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C \
 ALIX_GE04_PRIVILEGED_QUALIFICATION=1 ALIX_GE04_TEST_WORKER_UID=20002 \
 /usr/bin/timeout --signal=TERM --kill-after=5s 90s /usr/bin/python3 \
 -m unittest discover -s tests/agents -p test_ge04_native_stream.py -v
```

Exit 0; 31 test methods run, 30 passed, 1 skipped in 3.853 s. All 29 live transport methods passed. The unprivileged-only composition test was skipped under root and is not established by this VM run. Local unprivileged run: 2 passed, 29 skipped. The argument method includes 4 subcases, not 4 additional test methods. There was no failed privileged stream attempt; the first reviewed run passed.

`tests.txt` records each case: fragmented and coalesced frames; opaque fake identity; wrong UID/GID/PID/starttime; same-controller UID and dead peer; bad/zero/oversized framing; partial disconnects; accept/read/write timeout; inherited and mixed senders; one FD and 32 FD transfer rejection, actual MSG_CTRUNC diagnostic and received-FD balance; cancellation before accept/read/between frames/write phase; cancel-pipe HUP; peer exit in read/write; blocking listener refusal. Negative assertions require native exit classification, terminal retry denial and FD balance, not just client failure.

## Cleanup and witness

`host-before.txt` and `host-after.txt` retain labeled raw JSON. Both show zero UID/GID 20002 processes, no `/run/ge04-stream-*` entries, no UID/GID 20002 account/group (getent exit 2), trusted root 0755 `/run`. All created socket/build/fixture resources were removed. Existing witness remained active/running, PID 981, InvocationID `76b16df891ea439fb850303c99fdf0be`, start monotonic 20927201. No witness keys were read and no witness restart occurred.

## Limits

Trusted caller still supplies PID/UID/GID/starttime; this does not establish durable launch/registration/attempt provenance. A passed numeric PID is not authority. Tests do not force actual PID reuse; wrong generation and retained-pidfd exit are partial checks. Procfs/PID namespace custody is assumed. Sender provenance cannot prove the reader of an intentionally delegated response socket. A failed write can already have emitted bytes; write-phase cancellation is not an atomic broker final-effect fence. Uninjectable malformed kernel ancillary branches are source-reviewed only.

No cgroup descendant containment, filesystem/network sandbox, full hostile secret-store/keyring/high-FD denial, task-aware backend, crash recovery, broker inference, durable authorization, complete consumer migration/deletion or independent F sign-off is established. The production unavailable defaults and HOLD remain fixed.

## Raw evidence fingerprints

- `e9a36a9aa5686a63c8ffb5267741658c97de91c2ba6f216045897ec8f08ae211` — `host-after.txt`
- `4cffba644c8ef78caf5453ae72be0955d97b13f9ca7d85bc6bc02deccdf0835b` — `host-before.txt`
- `11af2de67a2c9ae15c0590aebfe5a1b224384eb554bc6eaee95d5871eb5314c1` — `tests.txt`

Graph safety: initial new native symbols were UNKNOWN; after indexing exact native implementation impact remained UNKNOWN/no callers resolved. Source audit confirms the C fixture is the only caller, not production. The Python case helper impact is HIGH with 29 direct test callers. Index process discovery explicitly reports capped/unexplored global flows; no claim of complete whole-program coverage is made. Required detect_changes result is recorded before commit, separately from that limitation.

## Provenance capture replay

Independent evidence verification identified that the first raw unittest log lacked the remote command/source-hash/exit transcript. Repeated the unchanged reviewed suite once solely to resolve that evidence gap. `reproduction.txt` captures remote SHA256 checks, exact executed command and SUITE_EXIT=0; again 30 passed, 1 skipped in 3.893 s. These are the same 29 live scenarios, not 29 additional distinct qualifications. `host-after-reproduction.txt` confirms the unchanged witness and zero process/directory residue again, with kernel/Python/compiler observations. SSH-observed engineering provenance is not independent host attestation.

- `09b07881f3449ab6568f3844fcb8bf53a05757df51b51b51703e60b5970061ed` — `reproduction.txt`
- `7a6b0e3ca5741a4b26bec8c7ea414f6d3c4e7953ba25eb29d78d3d2266ca7d10` — `host-after-reproduction.txt`

Initial staged detect_changes before provenance supplements: 12 files, 117 symbols, 6 affected native flows, HIGH risk; recursively no partial/truncated flags in the response. All 6 reported flows are native acceptance/identity/deadline/cleanup paths reviewed against source. Whole-index flow caps and missing native caller edges remain explicitly unresolved coverage limits.

Final analysis including provenance supplements: 14 changed files, 117 symbols and 6 native flows, HIGH risk; no recursive partial/truncated flags in the response. This does not remove the documented whole-index coverage limits.
