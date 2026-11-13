# GE-04 B1-A — Nonprivileged disabled-controller build probe

**Status: limited probe passed; source identity gate OPEN.** This is a test artifact only. No privileged execution or systemd unit creation.

A host-local probe compiled `native/ge04/protected-root-controller.c` with:

```sh
cc -std=gnu11 -Wall -Wextra -Werror -MMD -MF tmp/ge04-b1a-build-probe/held-controller.d native/ge04/protected-root-controller.c -o tmp/ge04-b1a-build-probe/held-controller
```

The disabled controller returned **77**. `readelf -h` reported ELF64, x86-64, PIE (`DYN`); `readelf -d` reported direct `NEEDED: libc.so.6`. The compiler-generated dependency file listed the controller source as its direct project input. Three `test_ge04_protected_dispatch_hold` tests passed.

The local, uncommitted `tmp/ge04-b1a-build-probe/receipt.json` records exact observed hashes, compiler arguments, ELF metadata and exit status. This probe **does not** demonstrate reproducibility, an independently approved toolchain, transitive sysroot/runtime dependency closure, a source-frozen build or a production controller/helper build. Host-local hashes are not approved identities. The compiler dependency file alone does not capture implicit toolchain/runtime inputs.

## Next qualification work

1. Resolve all per-target object, header, system-library and Python dependencies from actual build recipes, not only static test-file extraction.
2. Rebuild in an isolated, approved, immutable nonprivileged environment and compare artifacts and complete input receipts.
3. Audit privileged negative branches and obtain independent human security acceptance before any B1-A closure.

**GE-04 SECURITY HOLD ACTIVE. B1-A.03–A.10 remain subject to their respective gates.**
