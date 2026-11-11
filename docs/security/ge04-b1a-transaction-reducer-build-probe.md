# GE-04 B1-A — Non-authorizing transaction reducer object probe

**Status: local two-build probe passed; B1-A remains OPEN.** No root execution, worker admission, or systemd dispatch.

`native/ge04/protected-transaction-state.c` was compiled twice as **object files only**, using `cc -std=c11 -Wall -Wextra -Werror -Wpedantic -Wconversion -Wshadow -MMD -MF <depfile> -c <source> -o <object>`. Both nonprivileged host builds returned success and produced byte-identical objects. The compiler dependency files each list `protected-transaction-state.c` and `protected-transaction-state.h`; these are the observed **project-local** source/header inputs for this translation unit, not a full sysroot or runtime dependency closure.

`python3 -m unittest tests.agents.test_ge04_protected_transaction_state -q` passed (1 test). The local uncommitted `tmp/ge04-b1a-build-probe/transaction-state-receipt.json` records the full command arguments, source/header SHA-256 and both object SHA-256 values.

**Limitations:** This is one non-authorizing reducer, not a root-controller or helper production target. Two identical outputs on the same unapproved host do not prove cross-host reproducibility. No approved toolchain, complete header/sysroot closure, independent source acceptance, privileged negative-path audit or source-to-binary freeze has been established.

**GE-04 SECURITY HOLD ACTIVE.**
