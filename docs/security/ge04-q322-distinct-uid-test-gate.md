# GE-04 Q3.22 — Distinct-UID integration test gate

**SECURITY HOLD ACTIVE. Q3.22 is NOT independently validated until the opt-in test passes with one test executed (not skipped).**

The opt-in Linux integration test requires a root test **supervisor** in a disposable container. It launches the credential-free broker as UID 10001, an authorized worker as UID 10002, and an unauthorized worker as UID 10003 using `setpriv`. The broker uses the Linux kernel `SO_PEERCRED` helper. It verifies an authorized `OK`, rejection of the unauthorized UID and broker UID, and denial of reads of a broker-UID-owned mode-0600 test secret by both worker UIDs. The broker and workers are non-root processes. The supervisor owns temporary setup and cleanup. No real credentials are delivered.

The test requires a built `dist/` tree, `cc`, `setpriv`, and permission to switch UIDs. The broker socket is mode 0666 **for this test only** to exercise authorization rather than filesystem denial; this is not a production permission recommendation. The test helper is compiled into a temporary directory; production must install a trusted immutable helper. The test is skipped unless `ALIX_GE04_DISTINCT_UID_TEST=1` and fails if explicitly enabled without Linux/root privileges.

Run only in an authorized disposable Linux container, e.g. on microcloud3 after pulling this commit:

```bash
sudo docker run --rm --user 0:0 --cap-add SETUID --cap-add SETGID \
  -v "$PWD:/workspace:ro" -w /tmp node:26-bookworm bash -lc '
  apt-get update -qq && apt-get install -y -qq gcc libc6-dev util-linux &&
  corepack enable && cp -a /workspace /tmp/alix && cd /tmp/alix &&
  pnpm install --frozen-lockfile && pnpm build &&
  ALIX_GE04_DISTINCT_UID_TEST=1 pnpm exec vitest run tests/agents/ge04-q322-distinct-uid.vitest.ts
'
```

The container gets a read-only mount of the checkout, copies it to an ephemeral writable location, and uses disposable test data. Review the Docker command and permissions before running. Do not add the user to the docker group solely for this test. A test summary with `1 skipped` does **not** count as validation.

Remaining: broker-owned protected helper installation, parent directory and socket access policy, lifecycle and service identity, authoritative run/worker/attempt binding, replay ledger integration, revocation, and production wiring. Kernel UID attestation is only one trust boundary.
