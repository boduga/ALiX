# GE-04 B1-A.03 — Negative-path test traceability (static audit)

**Disposition:** Evidence mapping only; incomplete coverage and independent review remain blockers. No privileged execution authorized.

This index maps existing `test_ge04_protected*.py` tests to explicitly referenced C sources and linker-wrapper symbols. Presence of a test name does **not** prove it exercises every branch or error path. Wrapped root identities simulate privileged conditions; they are not privileged qualification.

| Test module | Tests | Referenced C files | Wrapped symbols |
| --- | ---: | --- | --- |
| `test_ge04_protected_approval_observer.py` | 6 | none explicit | none |
| `test_ge04_protected_cgroup_custody.py` | 2 | `protected-attempt-fence.c`, `protected-cgroup-custody.c`, `protected-keeper-custody.c`, `protected-prebirth-journal.c`, `protected-systemd-birth-observer.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_dispatch_hold.py` | 3 | `protected-dispatch-intent.c`, `protected-dispatch-preparation.c`, `protected-root-controller.c`, `protected-systemd-request.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_dispatch_intent.py` | 1 | `protected-attempt-fence.c`, `protected-dispatch-intent.c`, `protected-dispatch-preparation.c`, `protected-prebirth-journal.c`, `protected-systemd-request.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_dispatch_preparation.py` | 1 | `protected-dispatch-preparation.c` | `ge04_append_fixed_transient_request`, `ge04_systemd_recheck_original`, `getegid`, `geteuid`, `getgid`, `getuid`, `sd_bus_message_get_bus`, `sd_bus_message_get_destination`, `sd_bus_message_get_interface`, `sd_bus_message_get_member` … |
| `test_ge04_protected_keeper_custody.py` | 1 | `protected-attempt-fence.c`, `protected-keeper-custody.c`, `protected-prebirth-journal.c`, `protected-systemd-birth-observer.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_mount_namespace.py` | 1 | `protected-attempt-fence.c`, `protected-cgroup-custody.c`, `protected-keeper-custody.c`, `protected-mount-namespace.c`, `protected-prebirth-journal.c`, `protected-systemd-birth-observer.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_native_journal.py` | 6 | `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-root-controller.c` | none |
| `test_ge04_protected_owner_review_boundary.py` | 6 | none explicit | none |
| `test_ge04_protected_systemd_birth_observer.py` | 1 | `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-systemd-birth-observer.c`, `protected-systemd-transaction.c` | `ge04_systemd_recheck_original`, `sd_bus_call_method`, `sd_bus_get_property`, `sd_bus_get_property_string`, `sd_bus_get_property_trivial`, `sd_bus_message_read`, `sd_bus_message_read_array`, `sd_bus_message_unref` |
| `test_ge04_protected_systemd_job_binding.py` | 1 | `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-systemd-transaction.c` | `sd_bus_message_get_bus`, `sd_bus_message_get_reply_cookie`, `sd_bus_message_get_sender`, `sd_bus_message_get_type`, `sd_bus_message_has_signature`, `sd_bus_message_read` |
| `test_ge04_protected_systemd_request.py` | 1 | `protected-systemd-request.c` | `sd_bus_message_append`, `sd_bus_message_close_container`, `sd_bus_message_open_container` |
| `test_ge04_protected_systemd_signal_dispatch.py` | 1 | `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-systemd-transaction.c` | `ge04_attempt_recheck`, `ge04_prebirth_recheck`, `getegid`, `geteuid`, `getgid`, `getuid`, `sd_bus_process` |
| `test_ge04_protected_systemd_transaction.py` | 6 | `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-root-controller.c`, `protected-systemd-transaction.c` | none |
| `test_ge04_protected_transaction_state.py` | 1 | `protected-transaction-state.c` | none |

## Priority negative-path claims and test links

| Security boundary | Evidence to inspect | Remaining uncertainty |
| --- | --- | --- |
| Root entry returns 77 | `test_ge04_protected_dispatch_hold.py`, `test_ge04_protected_systemd_transaction.py` | Does not attest future binary/source identity |
| Exclusive create refuses | `test_ge04_protected_systemd_transaction.py`, `test_ge04_protected_dispatch_hold.py` | No trusted production send path qualified |
| Prepared send refuses | `test_ge04_protected_dispatch_preparation.py` | Wrapped preparation does not prove runtime bus behavior |
| Prebirth and attempt custody | `test_ge04_protected_native_journal.py` (attempt-fence modes 8, 9, 12–14) | Races, crash recovery and root provenance require independent audit |
| systemd signal/job binding | `test_ge04_protected_systemd_job_binding.py`, `test_ge04_protected_systemd_signal_dispatch.py` | Signal correlation is not authenticated unit birth |
| Keeper/cgroup/mount provenance | `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_mount_namespace.py` | Post-observation custody is UNQUALIFIED |

## Unclosed review tasks

1. Independently review each security-sensitive function against its full positive and negative branch set, not just test module presence.
2. Resolve source-to-test compile commands, linked objects, preprocessor configurations, external libraries, Python import paths and indirect calls.
3. Re-run on the exact pinned source snapshot and an approved toolchain, then retain test receipts.
4. Obtain independent security reviewer approval; no author-side artifact can satisfy this step.

**GE-04 SECURITY HOLD ACTIVE.**
