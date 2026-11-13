# GE-04 B1-A — Three protected modules, nonprivileged object-only probe

**Disposition: local probe passed; B1-A.03–A.05 still OPEN. GE-04 SECURITY HOLD ACTIVE.**

The following production-intended source files were each compiled twice as **objects only**, without linking or invoking any privileged code, on the unapproved host toolchain:

```text
cc -std=gnu11 -O2 -Wall -Wextra -Werror -Wpedantic -Wconversion -Wshadow -Wformat=2 -MMD -MF <depfile> -c <source> -o <object>
```

| Source | Project-local headers reported by compiler | Result |
| --- | --- | --- |
| `protected-attempt-fence.c` | `protected-attempt-fence.h`, `protected-prebirth-journal.h` | Two successful, byte-identical objects |
| `protected-prebirth-journal.c` | `protected-prebirth-journal.h`, `protected-attempt-fence.h` | Two successful, byte-identical objects |
| `protected-systemd-transaction.c` | `protected-systemd-transaction.h`, `protected-attempt-fence.h`, `protected-prebirth-journal.h` | Two successful, byte-identical objects |

The local, uncommitted receipt at `tmp/ge04-b1a-build-probe/protected-modules/receipt.json` includes exact argv, object and source hashes, compiler dependency output, and exit codes. Test suites run using `python3 -m unittest discover -s tests/agents -p '<module-test>.py' -q` passed: 6 journal and 6 systemd transaction tests. A direct `python3 -m unittest tests.agents...` invocation failed to import `test_ge04_prebirth_issuance_contract`; this was a test discovery path issue, not a failing security assertion, and the corrected invocation passed.

**Not established:** full transitive sysroot/system header closure, linker/runtime dependencies, actual production target linkage, independently approved toolchain, cross-host reproducibility, complete privileged negative-path audit, or human source acceptance. Object byte equality on one host is not sufficient for B1-A.05 or source-to-binary binding.

No root execution, systemd unit creation, worker admission or ACK was attempted.
