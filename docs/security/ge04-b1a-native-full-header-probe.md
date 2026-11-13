# GE-04 B1-A — Full compiler header and unresolved-symbol probe

**Status: host-local object dependency inventory captured; link/runtime closure OPEN. GE-04 SECURITY HOLD ACTIVE.**

Using `cc -std=gnu11 -O2 -Wall -Wextra -Werror -Wpedantic -Wconversion -Wshadow -Wformat=2 -MD -MF <depfile> -c <source> -o <object>`, three production-intended C modules were compiled as nonprivileged object files. Unlike `-MMD`, the `-MD` depfiles include compiler-observed system headers. `nm -u` enumerated undefined object symbols; this does not identify the final provider libraries.

| Translation unit | Compiler-observed source/header paths | Undefined symbol lines | Missing dependency paths |
| --- | ---: | ---: | ---: |
| `protected-attempt-fence.c` | 111 | 23 | 0 |
| `protected-prebirth-journal.c` | 110 | 19 | 0 |
| `protected-systemd-transaction.c` | 135 | 34 | 0 |

The uncommitted local receipt `tmp/ge04-b1a-build-probe/full-dependencies/receipt.json` records actual compiler arguments, SHA-256 hashes of all readable dependency files, object hashes, and undefined-symbol lines. The observed `pkg-config --variable=libdir libsystemd` was `/usr/lib/x86_64-linux-gnu`; `cc -print-file-name=crt1.o` and `cc -print-file-name=libgcc_s.so.1` resolved to host toolchain paths. These observations are **not** a link trace or attested library closure.

## Outstanding blockers

- Resolve all undefined symbols against actual, independently approved link commands and their transitive shared-library closure, including startup objects, loader and sysroot.
- Confirm target-specific build and deployment recipes; test harness linkage cannot stand in for production qualification.
- Freeze approved toolchain, headers, libraries, build inputs and outputs, then independently reproduce and review the hashes.
- Complete privileged negative-path and TOCTOU audit and obtain independent human security approval.

No privileged invocation, systemd unit creation, ACK, or worker admission was attempted. B1-A.03, B1-A.04 and B1-A.05 remain open.
