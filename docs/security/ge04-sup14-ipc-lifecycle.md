# GE-04 SUP-14 — IPC session lifecycle diagnostic

**SECURITY HOLD. This is an inert regression only, not credential provisioning, production authentication, execution admission, or receipt.**

`experiments/ge04/test-ipc-lifecycle.py` reuses SUP-12's in-memory challenge-bound session fixture. It confirms that a closed session rejects further requests, that a new randomly selected test secret cannot verify an old request, and that socket inheritance by a different process does not change the kernel's original peer-credential observation. The test is registered in GE-04 Linux CI.

**Limitations:** Both secrets are caller-controlled and held in ordinary process memory. They do not demonstrate independently provisioned key custody, protected process roles, authenticated session teardown across OS process crashes, or persistent replay protection. The socket inheritance test is an observation of `SO_PEERCRED`, not a proof that delegated connections cannot submit authenticated requests. SUP-11 also documents that the credential observation belongs to the original connector rather than the current socket holder. No mutation, helper launch, approval consumption, lease/policy coordination or terminal receipt is implemented.

**Follow-up:** Require independent role/secret provisioning and a strict FD-delegation policy; test actual transferred authenticated connections and process crashes under OS-enforced isolation before treating any session as authoritative. PR #1039 stays unmerged, and production `UnavailableScopedMutationService` stays disabled.
