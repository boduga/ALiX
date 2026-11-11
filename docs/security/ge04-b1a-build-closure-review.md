# GE-04 B1-A.03/B1-A.05 — Build and link closure review

**Disposition: PARTIAL / HOLD.** No privileged build execution or root testing is authorized.

The companion `ge04-b1a-test-build-recipe-index.json` extracts candidate native compiler invocations, flags, and C source references from the 15 `test_ge04_protected*.py` modules. These are **test-harness build recipes**, not an approved production controller or helper build recipe. Some tests compile dynamically generated C harnesses and use `-Wl,--wrap` to simulate systemd/root boundaries; a passing wrapped test does not establish actual privileged runtime behavior.

## Confirmed observations

- `test_ge04_protected_systemd_transaction.py` compiles the held controller with `protected-systemd-transaction.c`, `protected-attempt-fence.c`, and `protected-prebirth-journal.c`, using strict GNU11 warnings and libsystemd linker flags. This is a test artifact, not an approved deployment binary.
- `test_ge04_protected_dispatch_hold.py` separately compiles the disabled controller alone and checks its non-operational behavior.
- Other native test modules assemble differing source sets, wrapper flags and generated harnesses. The index is an extraction aid; actual compiler arguments must be reviewed against the full test source and resolved build traces.

## Blocking gaps

1. No independently approved, single canonical production controller/helper build recipe or complete target list is established by the test recipes.
2. The precise transitive C header, object, library and runtime dependency closure is not verified. Dynamic and indirect Python imports and C calls remain unresolved.
3. The source baseline pin does not attest the generated test harnesses or all build environment inputs.
4. No full negative-branch/TOCTOU/replay audit or independent security acceptance has occurred.

**GE-04 SECURITY HOLD ACTIVE.** B1-A.03 and B1-A.05 cannot be accepted from this evidence.
