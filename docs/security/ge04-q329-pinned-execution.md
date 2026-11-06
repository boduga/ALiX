# GE-04 Q3.29 — Descriptor-pinned native probe execution candidate

`native/ge04/exec-pinned-probe.c` uses Linux `execveat(3, "", argv, envp, AT_EMPTY_PATH)` to execute a descriptor-pinned native executable. `spawnPinnedNativeProbe` qualifies the executable path, opens it with `O_NOFOLLOW`, compares descriptor and path identity, and passes that descriptor as child fd 3. The parent closes its copy after spawn. The launcher is separately checked using Q3.23 root-owned, non-writable, symlink-free path preflight.

This is a **candidate**, not production qualification: the launcher is still spawned by pathname and may be replaced between preflight and execution by a privileged adversary; executable ancestry can change across checks; a trusted immutable installation is mandatory. This helper is not yet integrated with Q3.28's process lifecycle, and no native-to-governance handoff is authenticated. Independent root-in-container execution testing of the compiled launcher and binary is still required. The launcher accepts exactly three forwarded arguments, intended for the Q3.25 one-shot probe. No credentials are delivered.

**GE-04 SECURITY HOLD remains active.**
