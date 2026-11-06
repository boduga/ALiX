# GE-04 Q3.22 — Distinct-UID integration test gate

**SECURITY HOLD ACTIVE. Q3.22 is NOT validated.**

An opt-in integration test exercises a separate worker UID (65534), an allowlisted kernel-attested Unix socket connection, same-UID broker rejection, and a mode-0600 broker-owned secret that the worker UID cannot read. It does not deliver credentials. The test creates temporary test-only files and compiles the existing Linux helper. The socket is mode 0666 **for the test only** to allow different UIDs to connect; this is NOT a production permission recommendation.

Run only in a disposable Linux environment with authority to switch UID, and a working C compiler:

`ALIX_GE04_DISTINCT_UID_TEST=1 pnpm exec vitest run tests/agents/ge04-q322-distinct-uid.vitest.ts`

On ideapad the test was attempted but could not execute its cross-UID scenario: `setpriv: setresuid failed: Operation not permitted`. It is now opt-in and must **fail**, not skip, if explicitly enabled without privilege. The normal suite skips the privileged scenario. Do not count a skipped test as proof of isolation. For validation on microcloud3, use an authorized disposable privileged test environment rather than changing host accounts or granting the broker extra production privileges.

Outstanding: secure broker/worker service identity and lifecycle, protected helper installation, parent directory and socket access policy, process/attempt binding, replay ledger integration, revocation, and production configuration.
