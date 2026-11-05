# GE-04 — Inert systemd-managed supervisor prototype (NOT DEPLOYED)

**GE-04 SECURITY HOLD. Experimental service definition only. Production mutation authority remains unavailable and PR #1039 stays unmerged.**

## Design and implementation

The repository includes `experiments/ge04/alix-ge04-inert-supervisor.service`, an intentionally **non-installable** systemd prototype (no `[Install]` section). It has not been installed, started, or enabled under a live systemd manager. Startup requires a root-owned 0700 directory and 0600 `/etc/alix-ge04-inert/bootstrap.json` which identifies a protected installation directory, separate root-only authority state directory, root-managed IPC directory, a positive coordinator PID and non-root UID. The `managed-supervisor-entry.py` startup verifier requires root, checks fixed config fields and rejects malformed/duplicate entries, then invokes the existing root-only installation verification and starts the **inert** one-request supervisor. It does not authorize an actual mutation.

The sample systemd service sets `User=root`, `NoNewPrivileges=yes`, `CapabilityBoundingSet=` (empty), `ProtectSystem=strict`, `ProtectHome=yes`, `RestrictAddressFamilies=AF_UNIX`, `PrivateTmp=yes`, restricted namespaces, and limited writable runtime/state paths. It deliberately has `Restart=no`, a tight startup timeout, and no `[Install]` section. Every setting is a **proposal** until verified against the deployed kernel, packaged interpreter, real paths and supervisor behavior; adding a service definition does not make authority independent. The installed manifest inventory now covers both the installer and startup entrypoint in addition to the inert supervisor and supporting modules.

## Tests

- `test-systemd-inert-prototype.py` parses the sample unit, asserts the exact required hardening and absence of an install target, invokes `systemd-analyze verify` on Linux when present, and checks a nonprovisioned launch cannot pass startup validation.
- `test-protected-supervisor-installation-root.py`, running in privileged CI, now also provisions and checks a root-owned bootstrap configuration; rejects unsafe bootstrap mode; denies modification of the startup entrypoint and config by a distinct UID 65534; launches via the *managed startup gate*; and verifies a stale restart fails.
- Prior SUP-27 adversarial tests must continue reproducing same-UID state and receipt forgery. Success means the negative security finding persists, not that its broader threat model was resolved.

## Remaining blockers

1. The code and manifest are test-provisioned by root and validated by that same root: they are not an independently authenticated vendor release. Even with checks there remains check-to-exec/path substitution exposure against a privileged or same-UID attacker; runtime Python/interpreter provenance, package rollback protections and all ancestors are not fully pinned.
2. The systemd unit has **not** been run in an isolated systemd VM or container. The hardening settings could block necessary runtime calls or expose unexpected capabilities. Startup, crash-loop behavior, PID namespace handling, privilege dropping, open descriptor hygiene, and recovery must be tested by a real service manager.
3. An expected coordinator PID stored in a bootstrap file becomes stale on coordinator restart; a production service must have trusted enrollment/rotation with kernel-attested session binding and durable revocation.
4. The supervisor remains **inert**. No actual authorized operation, OS-enforced final effect boundary, trusted terminal effect receipt, or power-failure recovery exists. The privileged provisioner/root-equivalent compromise remains a release-blocking trust assumption.
5. No unit is installed or enabled, no privileged recovery automation exists, and no independent security reviewer has approved lifting the hold.

**Release decision: retain GE-04 SECURITY HOLD, do not merge PR #1039, do not enable production mutation.**
