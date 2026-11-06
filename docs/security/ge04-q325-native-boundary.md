# GE-04 Q3.25 — Native peer credential boundary (qualification only)

`native/ge04/broker-peer-probe.c` is a one-shot Linux AF_UNIX listener that calls `getsockopt(SO_PEERCRED)` on the **accepted socket** in the same native process. It does not use Node's undocumented `_handle.fd`, execute a helper, accept credentials from client JSON, access any secrets, or issue any authorization tickets.

The probe accepts exactly one connection, compares the kernel UID to a supplied allowed UID and a distinct broker UID, returns `OK` or `DENIED`, and exits. The socket is mode 0600; deployment and distinct-UID tests must deliberately arrange permissions for the authorized client. This is not the production protocol: a secure broker will require authenticated request binding, durable replay consumption, approval revalidation, peer process lifecycle, native executable integrity, and a protected socket directory.

Do not wire this probe into production credential delivery. GE-04 SECURITY HOLD remains active.
