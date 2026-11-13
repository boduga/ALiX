# Bounded native launcher observation — 2026-11-09 UTC

GE-04 SECURITY HOLD ACTIVE. Agent-executed engineering evidence, not independent human qualification, B2 completion or release approval.

## Provenance and preparation

Operator designated `ubuntu@10.1.1.13` in response to the explicit disposable Linux/root-probe question. Host alix-ge04-qual-01, Ubuntu26.04.1 LTS, Linux7.0.0-43-generic x86_64; Node26.11.0 (official archive SHA256 checked), pnpm11.28.11, Vitest5.0.5, GCC15.2.0. Source base `57d130b8e48222869ea8a9ccf139f8e77d0088b9` archived to a new isolated user workspace, plus these two independently reviewed fixture changes. No production native/backend implementation changed.

Installed compiler development dependencies with no upgrades/removals; package tool reported no service restart needed. Dependencies installed with frozen lockfile and lifecycle scripts disabled. No provider/model invocation, real credentials, keyring access, broker enrollment, account/sudoers or service changes were part of these probes.

Exact source fingerprints:

- `4a91aa56c3f07858ae5bbb6be0c8f0c75b33fc9abcd8abe362bc5172f26246bc` — `native/ge04/isolated-worker-launcher.c`
- `36c306b2306436251761f5bf0651869d2232839cceb432410d5f7ff7b463a908` — `tests/agents/ge04-r1b1-privileged-qualification.vitest.ts`
- `6a13380638ece6177b8a2c9130e54f43d689c90a4f5da0df27a0b0bf72f806a8` — `tests/agents/ge04-r1b1-native-backend.vitest.ts`

Standalone GNU package9.7-3ubuntu2.1 paths `/usr/bin/gnuid`, `gnuenv`, `gnucat`, `gnusleep` were root-owned0755 regular files beneath root-owned0755 ancestry. Shared library ancestry/targets likewise root-owned and non-writable to other users. SHA256 respectively:

- gnuid: `85bc7368ba0463e8dff0312965ffd8fc0e43cdb9f25e4210e11842465a4a6e3c`
- gnuenv: `d04fe689b718e25d083f8a438d1a903b9384c1588dbd7e8b88fdb384ef46fc49`
- gnucat: `6814736b3f95342e4ffc8f83f5cd99a2e72fd1a70b240cbc9d40609e48d73482`
- gnusleep: `2b1dc0b5878610372193de09e3a9b2dc5e9f4f65cd310765147fc02c0d1c6df9`

UID/GID20002 had no account/group or running process. Existing witness UID999/GID986 was distinct. `/run` root-owned0755, sufficient tmpfs space. Source and fixture reviewed independently before root runs; fresh-context instruction-file exclusion is not established by review isolation.

## Exact successful invocation

Working directory `/home/ubuntu/alix-ge04-workspaces/57d130b8-native-probe`:

```sh
sudo -n env -i  PATH=/opt/alix-ge04-qualification-tools/node-v26.11.0-linux-x64/bin:/usr/bin:/bin  HOME=/nonexistent LANG=C ALIX_GE04_PRIVILEGED_QUALIFICATION=1  ALIX_GE04_TEST_WORKER_UID=20002 ALIX_GE04_TEST_GNU_COREUTILS=1  /usr/bin/timeout --signal=TERM --kill-after=5s 60s  /opt/alix-ge04-qualification-tools/node-v26.11.0-linux-x64/bin/node  node_modules/vitest/vitest.mjs run  tests/agents/ge04-r1b1-privileged-qualification.vitest.ts  tests/agents/ge04-r1b1-native-backend.vitest.ts  --config vitest.config.mts --configLoader runner
```

This60s limit bounds synthetic fixture execution, not agent task lifetime.

## Observations and limits

3passed,1skipped, exit0. The UID/group/environment/root-canary/unsafe-ancestry test passed (1pass0skip in that file). Native backend live launch/kill/reap and containment-required refusal passed. The unprivileged composition test was skipped under root, explicitly not qualified by this run.

The first run without GNU selection failed: Rust multicall utility requested utility `4` from executable descriptor identity. Filename preservation alone did not suffice. No weakening of native checks was made; standalone installed GNU programs were selected only by an explicit test flag. The failure log is retained alongside the success log.

After each run no `/run/ge04-root-qualification-*` or `/run/ge04-backend-*` directory and no UID/GID20002 process remained. Witness before/after: active/running, PID981, InvocationID `76b16df891ea439fb850303c99fdf0be`, ExecMainStartTimestampMonotonic20927201. No witness keys read or witness restart performed.

The canary denial includes inaccessible directory ancestry, not isolated file-mode evidence. Sleep cleanup covers a controlled direct child only. No hostile descendant containment, cgroup write/attachment, stop gate, namespace/network isolation, authenticated IPC, descriptor-canary qualification, durable recovery, task-aware production backend, credential custody or broker final effect is established. No production authority or independent release sign-off is granted.

## Raw output fingerprints

- `e31d70726d35f2a2a8e9cb32a88ce84d59b7b0befb8ecdf29f2728438613bb96` — `initial-coreutils-failure.log`
- `c4c4675f7ea826698a411356ae7937cfc7f3e9d2553034df8a023418dfbba8b1` — `success.log`

- `e0f1370e4219344335b29dd9237dd25b1cdec25dd3506b682d8295b000bfeda7` — `host-observation.txt` (post-run raw custody/cleanup and saved pre-run witness snapshot; absent UID/process/directory queries print no rows).

GitNexus detected the two changed fixture files but extracted zero changed symbols; exact test File/helper impact remained UNKNOWN. A fuzzy file query returned CRITICAL unrelated paths and cannot qualify test coverage. Source review confirmed test-only changes and exact fixed call sites. This tooling coverage limitation is retained; zero is not an all-clear.
