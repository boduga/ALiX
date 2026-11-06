# GE-04 Q3.29 — Descriptor-pinned native probe execution candidate

`native/ge04/exec-pinned-probe.c` uses Linux `execveat(3, "", argv, envp, AT_EMPTY_PATH)` to execute a descriptor-pinned native executable. `spawnPinnedNativeProbe` qualifies the executable path, opens it with `O_NOFOLLOW`, compares descriptor and path identity, and passes that descriptor as child fd 3. The parent closes its copy after spawn. The launcher is separately checked using Q3.23 root-owned, non-writable, symlink-free path preflight.

This is a **candidate**, not production qualification: the launcher is still spawned by pathname and may be replaced between preflight and execution by a privileged adversary; executable ancestry can change across checks; a trusted immutable installation is mandatory. This helper is not yet integrated with Q3.28's process lifecycle, and no native-to-governance handoff is authenticated. Independent root-in-container execution testing of the compiled launcher and binary is still required. The launcher accepts exactly three forwarded arguments, intended for the Q3.25 one-shot probe. No credentials are delivered.

**GE-04 SECURITY HOLD remains active.**

## Independent privileged qualification command

Run on a disposable root-capable Linux host/container after building dependencies:

```bash
ALIX_GE04_PINNED_LINUX_TEST=1 pnpm exec vitest run tests/agents/ge04-q329-pinned-linux.vitest.ts
```

The gated test compiles the native launcher and probe under a root-owned `/root` directory, spawns the descriptor-pinned binary, replaces the pathname, and checks that execution does not fail at `execveat`. This tests executable pinning only, **not** a live authorized Unix socket exchange, broker restart, or authenticated governance handoff. The test must not be treated as passed until independently executed in the privileged environment.
