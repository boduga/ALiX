# GE-04 Q3.30 — Descriptor-pinned supervised lifecycle (partial)

Q3.28's credential-free `runSupervisedNativeProbe` now supports opt-in `trustedLauncherPath`. When provided, it uses the Q3.29 `spawnPinnedNativeProbe` instead of launching the native probe by pathname. It does not silently fall back if executable or launcher preflight fails. The existing timeout, bounded output, strict frame parsing, and child-exit checks remain unchanged. Negative tests exercise both untrusted launcher and executable rejection.

**Not yet qualified:** This change does not authenticate the stdout handoff, ensure the native listener's socket is owned and protected, bind kernel PID to a live worker claim, prove restart safety, or verify a successful pinned native-to-supervisor socket exchange. The launcher itself is still executed by pathname and requires trusted immutable deployment. Q3.29's privileged executable replacement test was reported passing independently; Q3.30's end-to-end privileged path has not yet been independently run. No production credential delivery.

**GE-04 SECURITY HOLD remains active.**
