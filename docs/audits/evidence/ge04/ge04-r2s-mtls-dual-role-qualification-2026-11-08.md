# GE-04-R2S — mTLS Publisher/Committer Binding Qualification (2026-11-08)

**Status:** Qualification-only; **GE-04 SECURITY HOLD ACTIVE**. No production mutation route, no publisher or committer deployment, and no independent anchor authority.

Related: [trust-service contract](../../../security/ge04-trust-service-contract.md), [offline enrollment](ge04-r2s-offline-enrollment-qualification-2026-11-08.md), [durable CAS negative test](ge04-r2s-durable-anchor-qualification-2026-11-08.md).

## Implementation and test boundary

`scripts/ge04-r2s-mtls-dual-role-binding.py` records **observations**, not authorization. The qualification function obtains a client certificate from the *actual server-side* `ssl.SSLSocket`, hashes its DER leaf certificate and resolves the hash against a supplied pinned fingerprint-to-principal/role map. It never reads role, principal or certificate fingerprint assertions from the HTTP request body.

The two observations share a strict, bounded, duplicate-key-rejecting `ge04-r2s-two-role-v1` request document: `requestId`, `anchorId`, `epoch`, `proposalSha256`, `expectedRevision`, and `expectedHeadSha256`. Only a `publisher` certificate may create a process-local observation; only a distinct `committer` certificate may endorse the **exact same byte sequence**. Changed proposal/epoch/identity, unknown, wrong-role, duplicate/replayed request, self-endorsement and malformed input are denied. An endorsement attempt consumes the pending token, including when the bytes disagree.

All results are `status:blocked`, `authorizationGranted:false`, `rollbackResistant:false`, and `independentAuthorityQualified:false`. A successful comparison merely includes `rolesBound:true` as **local evidence consistency**, never a grant, checkpoint commit, or authority qualification.

`tests/agents/test_ge04_r2s_mtls_dual_role_binding.py` starts an **ephemeral test-only** TLS 1.3 `ThreadingHTTPServer` on loopback, using a temporary test CA, leaf certificates and a fixture handler under `/fixture/`. **These fixture endpoints are not added to the R2Q or R2S witness server** and are never deployed. Tests exercise two distinct real TLS identities, missing certificates, unknown CA-authorized certificate identity, role swapping, replay, altered proposal bytes, wrong epoch, malformed/oversized JSON, bool revision and a misconfigured map that gives two certificates the same named principal.

## Explicit limits / outstanding gates

- The `identities` map and target anchor/epoch are caller-supplied qualification inputs; **no externally provisioned role directory, trusted CA, revocation, certificate expiry enforcement beyond TLS, rotation, operator credential isolation or independent enrollment approval is proven here**.
- The request's `proposalSha256` is a supplied digest, not a signed ALiX policy publication or an independently verified checkpoint. Comparing raw bytes does not authenticate the underlying proposal's authorization.
- The pending/spent request-ID set is **process-local memory**. Restart loses replay custody; neither nonce consumption nor commit authorization survives a crash. No SQL anchor call or worker admission path is wired.
- The real witness HTTP service continues to expose only the previous read/challenge handler in opt-in `serve-mtls`, with **no publisher/committer mutation endpoints**.
- Separate certificates and names do not establish separate administrative domains. No hardware-backed key custody or independent protected monotonic floor exists, and a restored witness/host can still roll back its database and signing key.
- The fixture server does not measure production rate limits, parser behavior, provisioning-file ancestry, network partitions or destructive recovery.

**Next gate:** separately enroll real publisher and committer identities under independent operators; cryptographically bind authorized policy proposals to committed checkpoint digests, persist single-use request/approval custody at the protected anchor, and qualify against a non-rollbackable external reference. Until then, preserve the GE-04 hold.
