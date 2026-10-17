# DOX — SRAP acceptance fixture

## Purpose

Inert, disposable infrastructure for the `SRAP-G3-ACCEPT` acceptance environment:
the isolated credential seeders, the loopback TLS proxy, the isolated denial
proxy, and the deterministic offline model server. It carries **no product
logic** and is never imported by `src/**`.

## Ownership

- `seed-key.mjs` — seeds the fixture `srap-evidence` HMAC key via the production `generateKey`.
- `seed-provider-key.mjs` — seeds/removes an isolated provider credential (`--list`/`--remove`).
- `proxy.mjs` — TLS-terminating loopback proxy (`127.0.0.1:4143` → Inspector).
- `negative-proxy.mjs` — denial-exercise proxy; never binds 4143; time-limited.
- `mock-model-server.mjs` — deterministic, keyless, tool-capable model server for `local-llama`.

## Local Contracts

- **Fixture-local, store-only credentials.** Every value stays inside
  `$SRAP_ACCEPT_ROOT`; the shared OS-user keychain is never selected, read, or
  written. The backend is forced to `plain-file` **after** the resolved
  credential dir is proven (symlink-aware) to stay inside the disposable root.
- **No argv secrets.** A secret is accepted only on stdin or a protected FD;
  the reserved `srap-evidence` namespace is refused; the value is never logged,
  echoed, or printed; the stored value is verified against the supplied secret.
- **No fabricated authority.** The mock server influences model output only; the
  proxies carry transport only. None may create, approve, reverse, or misreport
  an approval, audit record, decision, or success verdict.
- **Loopback only.** All listeners bind `127.0.0.1` and never `0.0.0.0`.
- **Canonical forwarding.** The proxy strips all client `Forwarded` /
  `X-Forwarded-*` / `X-Real-IP` / `Via`, then writes exactly one canonical
  `X-Forwarded-For` (observed socket peer) and one `X-Forwarded-Proto: https`.
  The Inspector requires both to classify `proxy-tls`.
- These scripts are inert fixtures: they are **not** production proxies and prove
  nothing about untrusted-peer rejection.

## Work Guidance

- Keep the fixture reproducible across platforms; the seeders use `isAbsolute`
  and platform-aware, realpath-canonical containment, not POSIX-only prefixes.
- Do not add product imports or network egress.

## Verification

- `tests/scripts/srap-seed-provider-key.vitest.ts` — seeder contract (stdin/FD
  handling, argv/reserved refusal, containment, stored-value equality, removal).
- Bootstrap results are recorded in `docs/2026-10-16-srap-g3-d2-d3-handoff.md`
  and `docs/2026-10-16-srap-g3-acceptance-fixture.md`.

## Child DOX Index

None.
