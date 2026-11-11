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
