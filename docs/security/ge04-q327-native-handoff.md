# GE-04 Q3.27 — Native-to-governance handoff contract (partial)

The native Q3.25 probe currently prints a `PEER pid=<pid> uid=<uid> authorized=<0|1>` line to stdout. Q3.27 adds a strict, bounded TypeScript parser for that **credential-free diagnostic format**. It rejects malformed, extra, overflowing, and noncanonical frames.

**Critical distinction:** syntax validation is not attestation. The parser is not connected to production. A malicious worker can forge an identical string. A production handoff must originate on a private, supervisor-created descriptor with verified child executable identity, controlled inheritance, process lifecycle, and no worker access. The native probe's `--test-public-socket` option is exclusively for disposable tests.

Next: design and test a supervised, dedicated native-to-broker channel; validate its provenance, child death, restart, and PID reuse handling. Do not pass parsed frames directly into `createGovernedBrokerAdmission` until that provenance is established. A robust design should preferably keep the accepted socket and credential decisions in one native broker process rather than trusting text passed over stdout.

**GE-04 SECURITY HOLD remains active. No production credential delivery.**
