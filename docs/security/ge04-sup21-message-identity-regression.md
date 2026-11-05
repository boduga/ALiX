# GE-04 SUP-21 — Same-UID identity and descriptor hygiene regression

**SECURITY HOLD. Experimental inert Linux AF_UNIX datagram checks; no production authorization.**

`experiments/ge04/test-kernel-message-identity-regression.py` verifies that a forked process with the same UID but a different PID is denied when the receiving fixture expects the original process PID. It confirms that the original process remains accepted, that an unexpected `SCM_RIGHTS` descriptor is rejected and closed without changing the receiver's FD count, and that oversized and empty datagrams are denied. The regression runs without root in the GE-04 CI job after the privileged SUP-20 test.

These checks strengthen test coverage but **do not** establish secure PID lifecycle binding or a nondelegatable authority: PID reuse, namespaces, same-UID compromise, authorized proxy forwarding, malicious root, and credential/session theft remain unresolved. The old stream-socket delegation bypass is still reproduced by SUP-16. No production mutation path is enabled; PR #1039 remains unmerged pending independent security review.
