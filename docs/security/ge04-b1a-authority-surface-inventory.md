# GE-04 B1-A.03 — Authority surface inventory and review disposition

**Status: author-side review coverage documented; independent security acceptance pending.** This is static inspection, not a proof of safety, runtime tracing or permission to execute privileged fixtures.

## Source revision and review scope

Candidate baseline `7a15a906488996bd677a246d2d24787d4fbf5b4e`; current checkout may include later documentation commits. All native C and Python translation units below were inventoried; all 69 tracked candidate files still require final exact build/source closure at B1-A.05–08.

## Native C/Python authority indicators

| File | Entry/functions (static heuristic) | Sensitive indicators |
| --- | --- | --- |
| `bootstrap_binding.py` | `_unique`, `parse_bootstrap_binding`, `read_sealed_bootstrap_binding` | none matched |
| `bootstrap_publisher.py` | `_exact`, `validate_prepublished_evidence`, `prepare_unprivileged_fixture_fd`, `publish_root_bootstrap` | none matched |
| `bootstrap_receiver.py` | `receive_bootstrap_descriptor` | none matched |
| `bounded_dispatch_evidence.py` | `__init__`, `status`, `observe`, `process_loss`, `authorize_send`, `issue_ack` | none matched |
| `bounded_job_signal_observer.py` | `_canonical_request`, `_canonical_witness`, `no_duplicates`, `observe_job_signal_bounded` | `subprocess.Popen`, `kill(` |
| `bounded_phase_observer.py` | `observe_bounded`, `unique` | `subprocess.Popen`, `kill(` |
| `broker-peer-probe.c` | `main` | `socket(` |
| `cgroup-control-fd-qualification.c` | `main` | `openat` |
| `cgroup-dirfd-qualification.c` | `fail`, `pin_root`, `main` | `openat` |
| `cgroup-leaf-ownership-qualification.c` | `valid_name`, `pin_root`, `main` | `openat`, `fstatat` |
| `cgroup-runtime-view-qualification.c` | `limits`, `controllers`, `inner_custody`, `budget_ok`, `same_inode`, `root_directory`, `pin_directory`, `regular_root`, `read_fd`, `open_regular`, `read_record`, `hex_string`, `approval`, `intent_text` … | `openat`, `O_EXCL`, `fstatat`, `unshare(`, `mount(`, `return 77` |
| `cgroup-worker-qualification.c` | `same_inode`, `root_directory`, `pin_directory`, `regular_root`, `read_fd`, `read_record_file`, `hex_string`, `approval`, `intent_text`, `read_intent`, `records_equal`, `control`, `open_controls`, `control_custody` … | `openat`, `O_EXCL`, `fstatat`, `setuid`, `return 77` |
| `cgroup2-fixed-preflight.c` | `inspect`, `main` | `openat` |
| `cgroup2-mount-preflight.c` | `main` | `openat` |
| `cross_source_birth_reconciliation.py` | `_original`, `reconcile_birth_packet`, `__init__`, `status`, `accept`, `recover`, `issue_ack`, `create_unit` | none matched |
| `diagnostic-deadline.c` | `deny`, `monotonic_ns`, `ge04_deadline_begin`, `ge04_deadline_remaining`, `ge04_deadline_check`, `ge04_deadline_quarantine`, `ge04_deadline_can_dispatch`, `ge04_deadline_can_ack` | none matched |
| `diagnostic-fd-wait.c` | `fail`, `ge04_diagnostic_wait_fd_cancel`, `ge04_diagnostic_wait_fd` | `EPERM` |
| `exclusive_birth_handoff.py` | `_exact`, `canonical_absence`, `canonical_creation_receipt`, `__init__`, `status`, `reason`, `quarantine`, `submit_creation_claim`, `corroborate_job_completion`, `corroborate_birth`, `recover`, `create_unit`, `issue_ack` | none matched |
| `exec-pinned-probe.c` | `main` | `execve` |
| `exec-pinned.c` | `main` | `execve` |
| `isolated-worker-launcher.c` | `die`, `trusted_directory`, `pin_executable`, `close_inherited_fds`, `main` | `openat`, `execve` |
| `isolated_job_signal_worker.py` | `main`, `no_duplicates` | `return 77` |
| `isolated_phase_observer_worker.py` | `main` | `return 77` |
| `nonexecuting-sender-contract.c` | `quarantine`, `ge04_sender_contract_init`, `ge04_sender_contract_observe`, `ge04_sender_contract_can_send`, `ge04_sender_contract_can_ack` | `EPERM` |
| `oci_qualification_image.py` | `_digest`, `_json`, `_octal`, `_header`, `_layer`, `_probe_from_layer`, `_descriptor`, `build_qualification_image`, `_reject_number`, `_unique_object`, `_decode`, `_follow`, `verify_qualification_image` | none matched |
| `original_provenance_diagnostic.py` | `_canonical`, `__init__`, `status`, `compare`, `authorize_send`, `issue_ack` | none matched |
| `peercred.c` | `main` | none matched |
| `phase_controller.py` | `decode_native_event`, `_exact_original`, `__init__`, `status`, `evidence`, `accept`, `issue_ack` | none matched |
| `pidfd-lifecycle-qualification.c` | `send_pinned`, `pinned_alive`, `main` | `kill(` |
| `pidfd-qualification.c` | `parse_pid`, `main` | `kill(` |
| `prebirth_fixture_journal.py` | `_fixture_directory`, `_read_exact_file`, `inspect_fixture_journal`, `publish_fixture_once`, `publish_observed_fixture_once`, `absent` | `O_EXCL` |
| `prebirth_issuance_contract.py` | `_exact`, `canonical_prebirth`, `canonical_birth`, `__init__`, `status`, `reason`, `observe_birth`, `quarantine`, `issue_approval`, `issue_ack`, `recover` | none matched |
| `protected-attempt-fence.c` | `deny`, `is_root`, `ge04_read_kernel_boot_id`, `ge04_attempt_custody_init`, `ge04_attempt_close`, `ge04_attempt_fence_encode`, `ge04_attempt_recheck`, `ge04_attempt_begin` | `openat`, `O_EXCL`, `fstatat`, `EPERM` |
| `protected-cgroup-custody.c` | `refuse`, `root_identity`, `ge04_cgroup_custody_init`, `ge04_cgroup_custody_close`, `snapshot`, `same`, `name_binds`, `fixed_root_open`, `revalidate_chain`, `fixed_root_open`, `ge04_cgroup_recheck_unqualified`, `ge04_cgroup_pin_unqualified` | `openat`, `fstatat`, `EPERM` |
| `protected-dispatch-intent.c` | `refuse`, `root_identity`, `manager_name`, `ge04_dispatch_intent_encode`, `ge04_dispatch_intent_init`, `ge04_dispatch_intent_close`, `ge04_dispatch_intent_recheck`, `matches_prepared`, `ge04_dispatch_intent_stage` | `openat`, `O_EXCL`, `fstatat`, `EPERM` |
| `protected-dispatch-preparation.c` | `refuse`, `root_identity`, `ge04_prepared_dispatch_init`, `ge04_prepared_dispatch_close`, `expected_headers`, `ge04_prepare_fixed_dispatch`, `ge04_dispatch_prepared` | `sd_bus_send`, `EPERM` |
| `protected-keeper-custody.c` | `denied`, `root_identity`, `ge04_keeper_custody_init`, `ge04_keeper_custody_close`, `read_proc`, `parse_startticks`, `sample`, `alive`, `ge04_keeper_recheck_unqualified`, `ge04_keeper_pin_unqualified` | `EPERM` |
| `protected-mount-namespace.c` | `deny`, `root_identity`, `ge04_mount_namespace_init`, `ge04_mount_namespace_close`, `decimal_id`, `parse_mountinfo`, `mountinfo_matches`, `namespace_id`, `open_keeper_namespace`, `ge04_mount_namespace_recheck_unqualified`, `ge04_mount_namespace_pin_unqualified` | `EPERM` |
| `protected-prebirth-journal.c` | `refuse`, `exact_hex`, `ge04_prebirth_encode`, `root_private_dir`, `root_parent_dir`, `original_file`, `reset_custody`, `ge04_prebirth_custody_init`, `ge04_prebirth_close`, `ge04_open_protected_directory`, `read_all_at`, `ge04_prebirth_recheck`, `ge04_prebirth_stage` | `openat`, `O_EXCL`, `fstatat`, `EPERM` |
| `protected-root-controller.c` | `main` | `return 77` |
| `protected-systemd-birth-observer.c` | `deny`, `get_exact_string`, `get_invocation`, `sample`, `ge04_observe_unqualified_postbirth` | `sd_bus_call_method`, `EPERM` |
| `protected-systemd-request.c` | `field`, `exec_start`, `ge04_append_fixed_transient_request` | none matched |
| `protected-systemd-transaction.c` | `deny`, `root_identity`, `unique_owner`, `current_root_manager`, `ge04_systemd_transaction_init`, `ge04_systemd_transaction_close`, `canonical_job_path`, `poison`, `apply_job_event`, `job_event`, `ge04_systemd_bind_job_reply`, `drain_pending`, `ge04_systemd_recheck_original`, `ge04_systemd_subscribe_original` … | `sd_bus_call_method`, `EPERM` |
| `protected-transaction-state.c` | `ge04_tx_can_retry` | none matched |
| `protected_approval_observer.py` | `_safe_dir`, `_directory_chain`, `_protected_file`, `corroborate_existing_approval` | none matched |
| `protected_owner_review_boundary.py` | `evaluate_protected_owner_review`, `__init__`, `status`, `inspect`, `_deny`, `publish_original`, `create_unit`, `issue_ack`, `recover`, `admit_worker` | none matched |
| `systemd_absence_observer.py` | `_absence_response`, `probe_fixed_unit_absence` | none matched |
| `systemd_job_event_contract.py` | `job_removed_diagnostic`, `__init__`, `status`, `accept`, `quarantine`, `issue_ack` | none matched |
| `systemd_job_signal_observer.py` | `observe_fixed_job_signal`, `on_signal`, `on_timeout` | none matched |
| `systemd_unit_observer.py` | `_unit_details`, `observe_fixed_systemd_unit`, `sample` | none matched |
| `transaction_consumption_fixture.py` | `_existing_consumption`, `inspect_consumption_after_restart`, `consume_packet_once` | `O_EXCL` |
| `unit_kernel_observer.py` | `_read_fixed`, `_stat_generation`, `_mount`, `_scope`, `observe_fixed_unit_kernel`, `proc_sample`, `observe_manager_and_kernel` | `mount(` |
| `worker-stream.c` | `close_owned`, `fail`, `ge04_stream_destroy`, `small_file`, `decimal`, `start_ticks`, `four_ids`, `zero_hex`, `restricted_ids`, `live`, `check`, `ready`, `ge04_stream_accept`, `controls` … | none matched |

## Authority classification and fail-closed boundaries

1. `protected-root-controller.c` is the disabled production-intended entrypoint (`return 77`); no linked operational controller has been accepted.
2. `protected-systemd-transaction.c` can perform manager subscription and query operations; `ge04_systemd_create_exclusive` refuses `EPERM`. `protected-dispatch-preparation.c` builds an in-memory request but `ge04_dispatch_prepared` refuses `EPERM`. These are source-level observations, not binary identity proof.
3. `protected-attempt-fence.c`, `protected-prebirth-journal.c`, `protected-dispatch-intent.c` and keeper/cgroup/mount custody sources handle privileged original-state/descriptor validation. Root-owned path, inode, mode and attempt checks are security-sensitive; completeness of race and crash defenses is **not established**.
4. `protected-systemd-birth-observer.c` and Python observers produce observations, not authorization. JobRemoved, manager output, unit paths and caller-supplied PIDs must not independently establish protected birth or ACK.
5. `isolated-worker-launcher.c`, `cgroup-worker-qualification.c`, `cgroup-runtime-view-qualification.c` and other standalone `main()` programs are **separate executable surfaces**. Some have mount/unshare operations; no claim is made that they are safe for root execution outside a named disposable VM.
6. Python bounded observers use subprocesses; subprocess timeout/termination and untrusted output handling require negative-path test evidence.

## Open review blockers (must be resolved before B1-A.03 is accepted)

- Human reviewer must verify all function-level call paths, including macros, indirect calls, Python imports, and build-specific linkage; this table is a heuristic inventory, not a complete call graph.
- Associate each security-sensitive function with negative-path tests and review failures/races/replay/TOCTOU.
- Reconcile the pinned source baseline with the exact build closure and all later changes.
- Independent security reviewer must sign off on the source and authority assessment; author-side review cannot self-approve.

**Disposition: B1-A.03 NOT ACCEPTED. GE-04 SECURITY HOLD ACTIVE.**
