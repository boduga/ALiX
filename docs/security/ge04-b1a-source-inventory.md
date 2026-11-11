# GE-04 B1-A.01 — Candidate source inventory

**Status:** Inventory captured; scope **not independently approved**. GE-04 SECURITY HOLD ACTIVE.

This is the tracked native/ge04 candidate set at branch HEAD, not a frozen or approved qualification source set. B1-A.02 must pin the revision and decide which files form the exact build/link closure. Dynamic dependencies, external headers, toolchain and scripts outside this directory remain **unresolved**. No privileged execution is authorized.

## Candidate native source/header and supporting Python files (68)

- `native/ge04/bootstrap_binding.py`
- `native/ge04/bootstrap_publisher.py`
- `native/ge04/bootstrap_receiver.py`
- `native/ge04/bounded_dispatch_evidence.py`
- `native/ge04/bounded_job_signal_observer.py`
- `native/ge04/bounded_phase_observer.py`
- `native/ge04/broker-peer-probe.c`
- `native/ge04/cgroup-control-fd-qualification.c`
- `native/ge04/cgroup-dirfd-qualification.c`
- `native/ge04/cgroup-leaf-ownership-qualification.c`
- `native/ge04/cgroup-runtime-view-qualification.c`
- `native/ge04/cgroup-worker-qualification.c`
- `native/ge04/cgroup2-fixed-preflight.c`
- `native/ge04/cgroup2-mount-preflight.c`
- `native/ge04/cross_source_birth_reconciliation.py`
- `native/ge04/diagnostic-deadline.c`
- `native/ge04/diagnostic-deadline.h`
- `native/ge04/diagnostic-fd-wait.c`
- `native/ge04/diagnostic-fd-wait.h`
- `native/ge04/exclusive_birth_handoff.py`
- `native/ge04/exec-pinned-probe.c`
- `native/ge04/exec-pinned.c`
- `native/ge04/isolated-worker-launcher.c`
- `native/ge04/isolated_job_signal_worker.py`
- `native/ge04/isolated_phase_observer_worker.py`
- `native/ge04/nonexecuting-sender-contract.c`
- `native/ge04/nonexecuting-sender-contract.h`
- `native/ge04/oci_qualification_image.py`
- `native/ge04/original_provenance_diagnostic.py`
- `native/ge04/peercred.c`
- `native/ge04/phase_controller.py`
- `native/ge04/pidfd-lifecycle-qualification.c`
- `native/ge04/pidfd-qualification.c`
- `native/ge04/prebirth_fixture_journal.py`
- `native/ge04/prebirth_issuance_contract.py`
- `native/ge04/protected-attempt-fence.c`
- `native/ge04/protected-attempt-fence.h`
- `native/ge04/protected-cgroup-custody.c`
- `native/ge04/protected-cgroup-custody.h`
- `native/ge04/protected-dispatch-intent.c`
- `native/ge04/protected-dispatch-intent.h`
- `native/ge04/protected-dispatch-preparation.c`
- `native/ge04/protected-dispatch-preparation.h`
- `native/ge04/protected-keeper-custody.c`
- `native/ge04/protected-keeper-custody.h`
- `native/ge04/protected-mount-namespace.c`
- `native/ge04/protected-mount-namespace.h`
- `native/ge04/protected-prebirth-journal.c`
- `native/ge04/protected-prebirth-journal.h`
- `native/ge04/protected-root-controller.c`
- `native/ge04/protected-systemd-birth-observer.c`
- `native/ge04/protected-systemd-birth-observer.h`
- `native/ge04/protected-systemd-request.c`
- `native/ge04/protected-systemd-request.h`
- `native/ge04/protected-systemd-transaction.c`
- `native/ge04/protected-systemd-transaction.h`
- `native/ge04/protected-transaction-state.c`
- `native/ge04/protected-transaction-state.h`
- `native/ge04/protected_approval_observer.py`
- `native/ge04/protected_owner_review_boundary.py`
- `native/ge04/systemd_absence_observer.py`
- `native/ge04/systemd_job_event_contract.py`
- `native/ge04/systemd_job_signal_observer.py`
- `native/ge04/systemd_unit_observer.py`
- `native/ge04/transaction_consumption_fixture.py`
- `native/ge04/unit_kernel_observer.py`
- `native/ge04/worker-stream.c`
- `native/ge04/worker-stream.h`

## Other tracked native/ge04 inputs (1)

- `native/ge04/AGENTS.md`

## Entry points and dependencies requiring closure

- Disabled protected root-controller entrypoint: `native/ge04/protected-root-controller.c` (returns 77).
- Other C qualification executables and Python `__main__` entrypoints: classify against test harness and planned root/controller build; **not approved** by this inventory.
- Resolve local `#include` closure, system headers, libsystemd and other link inputs, compiler flags, linker, libc, scripts and any generated files before B1-A approval.
- Do not treat a directory listing as a source-to-binary proof or an independent source review.
