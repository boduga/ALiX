# GE-04-R2S — Mutual-TLS identity and read API role guard (2026-11-08)

**Disposition:** Qualification implementation only. **GE-04 SECURITY HOLD ACTIVE.**
**Design:** [ADR-0018](../../architecture/adrs/ADR-0018-independent-trust-service.md), [threat model](../../security/ge04-trust-service-threat-model.md), [security contract](../../security/ge04-trust-service-contract.md).

## Changes

1. Added `scripts/ge04-r2s-transport-guard.py`: certificate SHA-256 fingerprint → explicit principal ID and role; strict manifest validation; certificate chain verification with TLS 1.3 and `CERT_REQUIRED`; denies unknown and wrong-role clients. Does not accept claimed roles in HTTP headers or user-supplied request JSON.
2. Extended existing `scripts/ge04-r2q-witness-service.py` with **opt-in `serve-mtls`**, not an additional service process. Requires independently provisioned server certificate/key, CA certificate, and client identity manifest. Same existing witness read/challenge handler; no HTTP write, key rotation, commit, approval or recovery route.
3. Current legacy `serve` on **127.0.0.1:18841** remains unchanged to preserve already deployed R2Q qualification. Its unauthenticated loopback-only mode is NOT a production trust interface; do not expose it to the LAN.
4. Added `tests/agents/test_ge04_r2s_transport_guard.py`: real ephemeral TLS server, ephemeral CA, client leaf certificates and certificate-role mapping. Covers valid verifier challenge/health, no client cert, unmapped identity, publisher/committer/operator unable to challenge/health, missing update endpoint and malformed/duplicated role manifest. Private test keys never leave the temporary test directory.
5. **No deployment** of `serve-mtls` on VM 10.1.1.13. No TPM state, host firewall, certificate trust store, production identities, protected anchor, issuer, scheduler or governance changes.

## Enforced read boundary (qualification only)

| Route | Verifier mTLS client | Publisher/committer/operator client | Unknown/anonymous |
|---|---|---|---|
| GET /health | Allowed, reports authorization:false | 403 | 403 or TLS handshake failure |
| POST /challenge | Allowed, returns signed R2P receipt of existing DB head | 403 | 403 or TLS handshake failure |
| Any publish/commit/rotate/reset route | Not implemented (403 with authenticated verifier, no new route) | Not implemented | Not implemented |

The TLS server must be explicitly launched as `serve-mtls` with four protected TLS/identity configuration paths, on loopback. Key/cert/CA files and manifest require root-owned, non-symlink, non-group/world-writable regular files, with no symlink aliases. This does not yet pin all protected parent descriptors, verify OCSP/CRL revocation or establish an independently trusted CA deployment.

## Remaining security qualification

- **Not a production service.** Current R2P signed schema lacks audience, key epoch, protected anchor reference, identity rotation and remote attestation.
- **No real independently administered identity enrollment** has occurred. Temporary test CA is not a trusted production issuer; explicit offline operator enrollment, revocation, emergency recovery and certificate renewal are pending.
- **No independent rollback-resistant revision floor** or protected signing key custody: the witness VM can be snapshotted with its signing key and SQLite head. The signer still reads a raw key; the signing code is not independently isolated from an administrator of the guest.
- **No network-facing service** or managed authentication agent was deployed. TLS is transport identity only; per-role publish/commit controls remain future design and are intentionally not exposed.
- **Input, parser and DoS hardening remain incomplete** (e.g. globally bounded request concurrency, duplicate JSON key rejection and strict HTTP/1 framing need independent review).
- **No production nonce custody proof**: the current TypeScript verification port still takes `consumedByVerifier` as a caller-provided test assertion.
- Before hold release: independent trust domain/key custody, real snapshot rollback, key compromise/rotation, concurrency/kill/restart, outage and split-view tests; existing governance/recovery and native host checks; independent operator security approval.

**Tests:** `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -q tests.agents.test_ge04_r2s_transport_guard`

**No code commit, merge or production authorization is implied by test results.**
