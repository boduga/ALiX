# GE-04 B1-A.04 — Observed toolchain (candidate, not approved)

**Status:** Environment observation only; B1-A.04 approval OPEN. GE-04 SECURITY HOLD ACTIVE.

This host is not an independently approved build environment. Observations do not pin package hashes, reproducible flags, kernel ABI or linked library identity.

## Observed host and tools

- **Architecture:** x86_64
- **Kernel:** 6.8.0-146-generic
- **Compiler:** cc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
- **Linker:** GNU ld (GNU Binutils for Ubuntu) 2.42
- **libc:** ldd (Ubuntu GLIBC 2.39-0ubuntu8.9) 2.39
- **libsystemd pkg-config:** 255

## Required before approval

- Identify and approve compiler/linker binary and package digests, exact command lines, flags, sysroot, headers and transitive libraries.
- Verify whether libsystemd development metadata and headers are available; a version string alone does not establish approved dependencies.
- Pin Linux kernel/ABI constraints and target architecture; distinguish build host from disposable qualification VM.
- Prove deterministic output or document and control reproducibility differences before binary hash freeze.
- Obtain independent reviewer acceptance; do not enable root execution or dispatch.

## B1-A.04 follow-up — Candidate executable identity manifest

`docs/security/ge04-b1a-toolchain-candidate-manifest.json` records resolved executable paths and SHA-256 digests for locally available compiler, assembler, linker, pkg-config and Python tools, plus libsystemd pkg-config flags and status. These hashes identify **observed host binaries only**; they are not package provenance or an approved toolchain. Build flags, full sysroot/header/library digests, runtime closure and reproducibility remain unresolved.

### Required next verification

- Resolve the exact native controller/helper build recipe from tracked test scripts and approved deployment scripts; record per-target flags and link closure.
- Hash the actual selected headers, linker libraries and runtime objects; approve architecture/kernel and trusted build host.
- Have an independent reviewer accept the complete immutable source + binary + toolchain identity set.
