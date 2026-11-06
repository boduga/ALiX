# GE-04 Q3.30 — Descriptor-pinned supervised lifecycle (partial)

Q3.28's credential-free `runSupervisedNativeProbe` now supports opt-in `trustedLauncherPath`. When provided, it uses the Q3.29 `spawnPinnedNativeProbe` instead of launching the native probe by pathname. It does not silently fall back if executable or launcher preflight fails. The existing timeout, bounded output, strict frame parsing, and child-exit checks remain unchanged. Negative tests exercise both untrusted launcher and executable rejection.

**Not yet qualified:** This change does not authenticate the stdout handoff, ensure the native listener's socket is owned and protected, bind kernel PID to a live worker claim, prove restart safety, or verify a successful pinned native-to-supervisor socket exchange. The launcher itself is still executed by pathname and requires trusted immutable deployment. Q3.29's privileged executable replacement test was reported passing independently; Q3.30's end-to-end privileged path has not yet been independently run. No production credential delivery.

**GE-04 SECURITY HOLD remains active.**

## Privileged integration gate

`tests/agents/ge04-q330-pinned-linux.vitest.ts` compiles the native binaries under root-owned `/root`, exercises the Q3.30 supervisor with fd-pinned execution, and connects clients as UIDs 10002 (allowed), 10003 (denied), and 10001 (broker UID, denied). It uses a world-connectable test-only socket in `/tmp`, enabled only with `ALIX_GE04_Q330_LINUX_TEST=1`. Run in a disposable root-capable Linux container. This test does **not** authenticate the stdout channel or bind a process to a live ALiX worker claim. The native probe is a diagnostic, not a credential broker.

## Q3.30 privileged failure correction

The initial independent run failed with native exit 64 because the pinned launcher forwarded its own `argv[0]` into the probe and required the wrong argument count. The launcher now requires five or six launcher arguments (including launcher `argv[0]`) and invokes `execveat` with `argv + 1`, so the probe sees the expected four or five arguments. The test also observes early supervisor rejection immediately to avoid unhandled promise rejections during socket readiness polling. This correction requires a new independent privileged run; local unprivileged tests alone do not close the gate.
