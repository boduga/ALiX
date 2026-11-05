# GE-04 — OS-enforced distinct-UID supervisor fixture (post SUP-27)

**Release decision: SECURITY HOLD. No production mutation authority. PR #1039 remains unmerged.**

SUP-27 demonstrated two same-UID bypasses: a fixture owner could rewrite an already revoked SUP-25 state and could recompute SUP-26 HMAC evidence using a credential available to that owner. The new privileged Linux regression tests a *narrower trust boundary* that removes the coordinator's direct filesystem access to those objects.

## Fixture setup

A root-run test provisioner creates a root-owned 0700 private authority directory containing SUP-15's root-owned credential, SUP-25 state, and SUP-26 observation. A separate root-owned 0711 public endpoint directory allows an untrusted coordinator to reach only an inert AF_UNIX datagram socket. The separately exec'd coordinator drops supplementary groups and changes to UID/GID 65534; the supervisor is a separate root process with its own credential and authority-state file descriptors, not inherited from the coordinator. The root supervisor pins the coordinator process using SUP-22b kernel-delivered per-message pidfd/credentials and accepts only one fixed inert request. It performs the SUP-25 inert transition and SUP-26 test observation itself. No real mutation or receipt is issued.

The adversarial child attempts to read the protected key and state, overwrite the state with a revocation bypass, forge the terminal observation, and loosen directory permissions. **Each must be denied by actual Linux directory/UID protection**, not by the cooperative lock or a declarative role field. The child can still send its fixed inert datagram to the public socket. The regression asserts consumed approval state and a local inert observation after the service process exits. CI requires privileged Linux execution.

## Trust and release limitations

- The root **test provisioner** still creates the key, state, and supervisor process. This models a privileged OS-managed launch but does **not** instantiate or verify systemd unit hardening, a production installation trust anchor, independent upgrade/rollback policy, or boot-time lifecycle management.
- This boundary protects against the specified distinct, non-root coordinator UID only. A root-equivalent attacker, local privilege escalation, compromised supervisor, or privileged provisioner can read/rewrite the files and forge observations. SUP-27's same-UID adversarial reproductions remain valid and must continue running in CI.
- Fixed test inputs, public world-writable socket permission 0666, and root-owned 0711 endpoint directory are **fixture-specific**. Public IPC exposure, DoS, socket floods, PID namespace support, identity provisioning, resource limits, and trusted policy configuration require a complete production design. Repeated requests are not supported.
- The SUP-25 state and SUP-26 HMAC remain inert and fixture-controlled. No user-approved real operation or final OS mutation boundary exists, no independently authenticated real-effect receipt exists, and no crash/power-loss recovery qualification has been performed.
- The old stream-socket delegated-descriptor bypass remains real for that old transport. No bridge to it is enabled. The live PID and message pidfd kernel assumptions require full deployment qualification.

This checkpoint narrows the SUP27-F1/F2 threat model for an **unprivileged distinct-UID coordinator** but does not close those findings generally. A future reviewer must validate the threat model, supervisor installation, actual operation-level state machine, durable receipts, and adversarial fault tests before unblocking GE-04.
