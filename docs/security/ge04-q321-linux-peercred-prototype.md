# GE-04 Q3.21 — Linux kernel peer credentials prototype

**SECURITY HOLD ACTIVE. No credential delivery or production broker wiring.**

`native/ge04/peercred.c` invokes Linux `getsockopt(SOL_SOCKET, SO_PEERCRED)` on inherited accepted socket FD 3 and prints PID, UID and GID. `createLinuxPeerCredentialAttestor` spawns this helper with the accepted socket FD passed as child FD 3, parses its bounded output, and fails closed on missing FD, helper failure or timeout. This is a real kernel-backed credential query, not a client-supplied UID. Tests compile the C helper into a temporary directory, connect over a Unix socket, verify the actual PID/UID, and reject a same-UID connection through the broker policy.

**Deployment gaps:** The TypeScript adapter uses Node's undocumented `_handle.fd`, so compatibility and supported runtime need qualification. The helper path is operator-supplied and must be protected from worker replacement; the prototype does not validate ownership or permissions. Helper spawning per connection has cost and race/lifecycle considerations. The current socket server does not enforce filesystem ownership/mode or distinct-UID worker deployment. Kernel credentials prove connecting process identity at connect time, not a trusted run/worker/attempt binding. The tests do not exercise a distinct-UID successful connection. Q3.20 in-memory replay and Q3.21 SQLite replay are still not integrated. No production secrets are exposed.

Compile for manual local tests: `cc -O2 -Wall -Wextra -Werror -o /tmp/alix-ge04-peercred native/ge04/peercred.c`. Do **not** use a world-writable helper path in a deployed broker; install a reviewed helper under broker-owned, immutable permissions instead. The temporary compilation path is only for tests.
