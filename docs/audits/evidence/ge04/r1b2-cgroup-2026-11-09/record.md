> **HISTORICAL EVIDENCE ONLY — superseded for current worker source (2026-11-11).** This packet applies to worker source SHA-256 `5362bdb0b08586f51151f0b53519a48ababb557f9c31758283f3aab2ec06d757` and controller SHA-256 `5f65166afc7a66c8d56370b40df32a55f16c82b4adb9fddfaa4eab05985d4174`. HIGH-1/HIGH-2 hardening changes the `crash-leaf` sweep result from success-by-name-adoption to 77/QUARANTINE; the old 24 live passes do not qualify the revised implementation. No privileged rerun or release is authorized.

# Fixed cgroup synthetic qualification — 2026-11-09

GE-04 SECURITY HOLD ACTIVE. Refs #1054 and #1055; neither issue is completed by this fixture.

## Scope and authority

The operator designated `ubuntu@10.1.1.13` in response to the disposable Linux/root-only synthetic-probe question and selected exclusive cgroup ownership as recovery authority. This authorizes only the reviewed closed fixture, not production execution or credentials. Fresh-context native source and controller/root-scope reviews completed before execution; their staging-inventory and original-inode findings were fixed and re-reviewed. Agent review supplies no independent human release approval.

Parent source HEAD: `90c0042f30db7a88203e1e1af4aab7e1abd1f914`, with the exact uncommitted source files hashed below. No production consumer is added. The fixed worker drops to UID/GID20002, forks one setsid descendant and idles. It accepts no arbitrary executable, path, PID or UID. Root staging contains only frozen reviewed source/controller, trusted compiled helper and manifest, protected against unprivileged changes.

## Executed evidence

- `transcript.txt`: remote UTC, root-verified source hashes and compiled binary manifest; original staging inode receipt; exact isolated privileged invocation; real unit identity and phase observations; complete 29-method suite output and `SUITE_EXIT=0`.
- VM suite: **28 passed, 1 skipped**, including **24/24 live cgroup methods**. The root run skips the nonroot-refusal method explicitly; it does not establish that refusal. The local unprivileged run establishes it instead: **5 passed, 24 skipped** (`local-tests.txt`). Skips never count as passes.
- Actual VM unit: invocation `a542bb11d93f497393f1cb55e5e2361b`, keeper PID8062. Private ownership checks cover atomic cgroup birth, stop/attach/readback/resume, descendant collective cleanup, helper crashes at named barriers, protected-record mismatch, changed leaf/control custody quarantine, writer contention, and interrupted-controller-handler recovery while controller remains alive.
- `host-before.txt` and `host-after.txt`: unchanged witness invocation/PID/start timestamp; after execution zero processes with synthetic UID or GID20002, absent private work/cgroup/staging directories and inactive/not-found qualification unit. The original witness stayed active/running. Observations are controller-collected evidence, not independent host attestation.
- `staging-identities.json`: original bootstrap device/inode receipt, independently compared before use and deletion. The separate cleanup script verified the complete allowlist, original identities and hashes before deleting only four fixed files and empty directories. No recursive cleanup or unrelated unit stop occurred.
- `reviewed-stage-and-run.txt` and `reviewed-verify-and-clean.txt`: exact reviewed execution packets retained as text for reproducibility. They contain consumed fresh-path assumptions and fixed source pins; do not rerun blindly or treat them as production scripts. The user-owned uploaded source workspace is retained.
- `existing-vitest.txt`: 16/16 existing stop/attach, durable-launch and recovery-gate regressions passed locally.

Final fresh-context source/doc recheck found no actionable scoped P1/P2 regression (`source-review.txt`). The separate evidence verifier reproduced local tests and strict GCC static analysis, checked fingerprints/results and found no blocker to the bounded reporting (`evidence-review.txt`). Preserved packet text is not independent historical attestation; no binary was retained for later rehash, and the saved inode receipt alone does not contain all custody fields observed by the controller.

## Limits and remaining gates

This establishes only the named closed synthetic cases on one disposable VM. Injected EBADF and record mismatches are not genuine disk faults, actual PID reuse, hostile root substitution or mount replacement. Helper-death recovery assumes the trusted controller and unit survive; interrupted handlers are not whole-controller death or reboot qualification. No hostile filesystem/network sandbox, credential store/keyring isolation, combined stream/process registration, task-native backend, broker provider call, durable final-effect authorization, migration/restore or independent release is established. R1-B1 task/backend integration and full B2 acceptance remain open, followed by C–F. No hold clearance, broker admission or createScopedMutationService is enabled.

## Fingerprints

- `native/ge04/cgroup-worker-qualification.c`: `5362bdb0b08586f51151f0b53519a48ababb557f9c31758283f3aab2ec06d757`
- `tests/agents/test_ge04_cgroup_worker.py`: `5f65166afc7a66c8d56370b40df32a55f16c82b4adb9fddfaa4eab05985d4174`
- `existing-vitest.txt`: `53e9d27afa0e858358ba470f0fcc4fd1e3feed1123545a3defdd740d9f791718`
- `host-after.txt`: `daf892506e5350265c958a03e6e86e6e5feb6539436b1928fc352d2ec2cb605c`
- `host-before.txt`: `deaa3f74dc470837577bb8d9ee106470c171c41e08c785c447f21fff2ac2fda0`
- `local-tests.txt`: `666073f33321422cdfd30f0066f125fdf4ae83605d4416dc7666ddb33e3f90e9`
- `reviewed-stage-and-run.txt`: `ab61924d92bee4fe717680ffa440e86efe9771f603c7dbe78ca64b7030296603`
- `reviewed-verify-and-clean.txt`: `89bf2970333a0c5e6083c7b63d14db58ff3fefb466be16d0a114e11035b1defb`
- `staging-identities.json`: `8366b5d4b7ff195d59d81ea202bef832268d923b6f193990dd181898b08b3925`
- `transcript.txt`: `6de6dd265c2b017fe695a91951acb6c24581012786fad402b7a950a095a3d9bd`
- `source-review.txt`: `2a192fa526f96bd8433c97b8dc87ea635439da5ed8637960acd3aa5c67dd94e7`
- `evidence-review.txt`: `b846c50222d211cf95ca06495a3ce6c56496d72cc9f05762425d8849eca683e1`

## Repository verification

Normal and unused TypeScript checks passed. Staleness audit walked4,968files with0stale references. Source/doc whitespace check passed; the unmodified raw Vitest transcript retains its trailing blank line. Required pre-edit impacts were LOW for worker/bindings/setup/staging and MEDIUM for controller invocation/unit validation; unresolved file/cross-language results were source-audited. Final GitNexus refresh completed (98,941nodes,227,416edges,1,243flows); BM25/FTS build failed and global flow caps omitted candidate paths, so this is not whole-program proof. Staged detect_changes reported16files/40symbols/0affectedflows, riskLOW and no partial/truncated response flags after recursive array/object inspection. Zero flows does not establish no runtime effects: the exact closed C/Python fixture and root packet were separately reviewed. Production composition remains absent.
