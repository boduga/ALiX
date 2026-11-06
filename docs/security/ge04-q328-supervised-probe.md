# GE-04 Q3.28 — Supervised native probe lifecycle (partial)

The credential-free `runSupervisedNativeProbe` launches a configured absolute executable without a shell, with stdin closed and private parent-created stdout/stderr pipes. It bounds execution time and output size, requires a clean child exit, and parses exactly one canonical `READY` plus `PEER` diagnostic frame. Negative tests cover extra frames, missing readiness, child failure, timeout, and invalid configuration.

## Not a trusted production handoff

This is a **lifecycle prototype**, not authenticated native attestation. Tests deliberately use shell-script stand-ins, demonstrating that any executable with access to the pipe can fabricate the same output. The code does **not** verify root-owned executable ancestry, fd-pinned execution, native executable identity, socket ownership, kernel peer identity provenance, or live worker process identity. It is not wired into governed admission or credential delivery. A timeout kills the direct child but not necessarily its descendants. `READY` is buffered rather than acted on as a live handshake, so this API cannot currently coordinate a client connecting to the listener.

Next qualification must use a verified native executable, protected socket path and descriptor provenance, real distinct-UID tests, and authenticated handoff to the broker's authorization process. Prefer a single native broker security boundary to avoid serializing kernel identity into spoofable text.

**GE-04 SECURITY HOLD remains active.**
