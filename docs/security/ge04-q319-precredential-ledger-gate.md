# GE-04 Q3.19 — Precredential durable claim gate

**SECURITY HOLD ACTIVE. Opt-in consistency check, NOT authenticated authorization.**

The Q3.18 opt-in `--ge04-route-preflight` child path now runs `assertPrecredentialWorkerRouteClaim` **before** `readWorkerCredentialSnapshot` and `loadConfig`. It loads the persisted coordination run, requires a running worker with the expected attempt and owner, a non-revoked snapshot and internally consistent route evidence. Only then does the existing loader run; the later Q3.18 canonical route check still runs before `createProvider`. Legacy path and scheduler remain unchanged.

The gate reconstructs the candidate route from persisted evidence solely to verify its fingerprint/claim consistency. A SHA256 digest is not a signature. The worker supplies its own owner claim and has same-UID access to project state; a malicious worker may forge both state and config. The gate neither authenticates scheduler authority nor prevents broader credential access, and it cannot enforce route authorization before config load. No credential grant or delivery behavior is changed. **Do not enable production credential delivery.**

Future work: authenticated broker-side precredential authorization, distinct-UID isolation, independent canonical route provenance, and complete fallback-capable provider construction. Test end-to-end negative paths before lifting the hold.
