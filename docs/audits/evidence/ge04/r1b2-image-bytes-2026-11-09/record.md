# Canonical qualification image bytes — 2026-11-09

SECURITY HOLD ACTIVE. Refs #1054/#1055; no issue completion or release.
Baseline6582e0c6 with the reviewed uncommitted image construction delta.

This pure standard-library Python module packages opaque1byte..1MiB payloads in
one fixed Linux amd64 OCI layout and verifies that format against a caller pin.
It has no CLI, extraction, filesystem/process/network operation or runtime
consumer. An inert nonexecutable fixture is accepted intentionally: construction
and integrity are not source provenance, code safety, custody or admission.

`tests.txt`:18/18unprivileged unittest methods pass, no skips. The separate
verifier reproduced all18 and independently derived the USTAR/canonical JSON
fingerprints without implementation helpers. It observed90reject-helper calls:
all21rehashed unsafe header cases and7checksum/padding/truncation/trailing cases
reached the layer decoder; all6rehashed config changes reached final exact-map
reconstruction. These are instrumentation observations within18methods, not90
independent test methods. See evidence-review.txt for procedure and limits.

Source review reported no actionable scoped findings (source-review.txt).
Readiness/security design re-audits accepted this narrow byte-only boundary after
removing arbitrary mapping-proxy inputs; broad native findings remain open.

Independent inert fixture: `GE04 inert image fixture\n` (25bytes).
- Probe:sha256:8be521d158830d3c900bc33d600699ee9037f5d011805e1ffce13b868a5a37db
- Layer:sha256:430b3cc95a6e1e50068b79a75b32a75ca84742cdddde9fc72081899170159ef9
- Manifest:sha256:5c5bdbac2f073c900785aecfce6c52e48c1a15c374174c5e3a905e0521b651ab

Operator selected an outer supervisor-owned cgroup and runc-owned inner payload.
That is a design direction, not evidence for the nested lifecycle. Existing
single-leaf/stream evidence remains bounded to its frozen sources. Root staging,
effective runtime/syscall policy, actual hostile worker/Node image, bundle and
registration custody, crash recovery, task fragmentation, broker/final-effect
authority, migration and independent F remain open. No container or downloaded
runtime was executed by this increment; no production composition is enabled.

## Fingerprints

- `native/ge04/oci_qualification_image.py`: `7f96b8a9a6f80c6538bd996a77ace82e150fdd4a7329f009bc5ca7bc8d14eabb`
- `tests/agents/test_ge04_oci_image.py`: `24a448d64ec1a0bda83a68274f06172aad0a75a3e5584dd201e81e55876e40aa`
- `evidence-review.txt`: `46deaee5c7c76a198137ec9b0bec055b8121f52d538a9ec57b62105987b4de83`
- `source-review.txt`: `65e21db6d988469e95c7d0b8a7d35c1040a5c67326ae268be9ecf28dacab606b`
- `tests.txt`: `fae94ace31f4ba44c8b3efd25f93933ff451f1ef756da8e540c35a457f23ec1d`

## Repository checks

Normal and unused TypeScript checks passed. Staleness walked4,973files with0stale
references; source/evidence whitespace check passed. Applicable root/docs/native
contracts were read; nearest native owner was updated. Root/docs ownership and
child indexes remain accurate, so no broader instruction change was required.

Pre-edit GitNexus impact returned UNKNOWN for the two not-yet-existing public
functions; exact source search confirmed neither existed and this new module
has no production import/consumer. No zero-caller safety claim was made. Final
refresh completed99,045nodes/227,619edges/1,244flows with BM25/FTS disabled and
global flow truncation/callable caps. Staged detect_changes reported9files and
31symbols,0flows,LOW risk, no response partial/truncated flags after recursive
array/object inspection. Zero flows is not whole-program completeness; source
review establishes this module's explicit disconnected byte-only boundary.
