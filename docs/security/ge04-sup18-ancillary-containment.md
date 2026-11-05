# GE-04 SUP-18 — Cooperating endpoint descriptor containment

**SECURITY HOLD. Experimental ancillary-data hygiene, not global OS-enforced delegation prevention or mutation authorization.**

`experiments/ge04/ancillary-fd-denial.py` receives a single bounded, inert Unix datagram through `recvmsg` and rejects any ancillary control message, oversized or truncated frame, and empty payload. When an `SCM_RIGHTS` descriptor is received, the fixture closes it in a `finally` block, even on rejection. Where supported, `MSG_CMSG_CLOEXEC` also requests close-on-exec on any received FD. The receiver never turns a frame into an execution grant.

`experiments/ge04/test-ancillary-fd-denial.py` exercises ordinary benign frames, an actual FD transfer with a leak check, oversized and empty messages, invalid transport type, and a clean child `exec` with `close_fds=True` and `pass_fds=()` excluding a deliberately inheritable test descriptor. Linux CI runs this regression alongside SUP-16's **positive reproduction of the descriptor-delegation bypass**.

**Scope boundary:** The receiver is a cooperating fixture. A process with access to a separate socket can still send descriptors through that path; a compromised authorized role can issue preauthenticated requests or pass connections. `SO_PEERCRED` does not attest a current FD holder. This does not restrict arbitrary `SCM_RIGHTS` sends across the process, guarantee all descriptors were found at startup, control a process's memory, or validate secure coordinator role bootstrap. Explicit child-FD allowlists and OS service-manager isolation are required, and production roles must never receive credentials or authenticated sessions solely by descriptor possession. Credential custody, durable replay/receipt, and final-boundary approval/lease serialization remain unresolved.

PR #1039 must remain unmerged. Production `UnavailableScopedMutationService` stays disabled. An independent security review is still required before any change to the SECURITY HOLD.
