/**
 * G3-A′ — authentication parity table (broader than the handler).
 *
 * The authoritative decision is the credential state × transport × principal
 * state matrix. A bound credential never falls back to ordinary access; only a
 * genuinely unbound legacy credential does. Role and workspace scope are
 * preserved for the allow case on both transports.
 *
 * Modelled on `tests/ownership/path-scope.test.ts`: explicit expected outcomes
 * for every combination, so a change that fixes one row cannot silently break
 * another.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AuthStore, createTokenRecord, createRevocation } from "../../../src/governance/security/inspector/auth-store.js";
import { PrincipalStore, createPrincipalRecord } from "../../../src/governance/security/inspector/principal-store.js";
import { AuthService, type AuthTokenRole } from "../../../src/governance/security/inspector/auth-service.js";
import { generateToken } from "../../../src/governance/security/inspector/token-format.js";

function tempDir(): string {
  return join(tmpdir(), `alix-principal-parity-${randomUUID()}`);
}

const noopAudit = () => {};
const noMetrics = () => {};

type CredentialState = "unbound" | "bound-active" | "bound-disabled" | "bound-missing" | "revoked" | "expired";

interface Row {
  state: CredentialState;
  bearer: "allow" | "deny";
  cookie: "allow" | "deny";
}

/** The matrix. Exhaustive over credential state × transport. */
const ROWS: Row[] = [
  { state: "unbound", bearer: "allow", cookie: "allow" },
  { state: "bound-active", bearer: "allow", cookie: "allow" },
  { state: "bound-disabled", bearer: "deny", cookie: "deny" },
  { state: "bound-missing", bearer: "deny", cookie: "deny" },
  { state: "revoked", bearer: "deny", cookie: "deny" },
  { state: "expired", bearer: "deny", cookie: "deny" },
];

describe("principal authentication parity", () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempDir();
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(state: CredentialState): Promise<{ service: AuthService; rawToken: string; tokenId: string }> {
    const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
    const service = new AuthService(store, noopAudit, noMetrics, { principalStore: principals });

    const gen = generateToken();
    const record = createTokenRecord({ id: gen.id, hash: gen.hash, name: state, role: "operator" as AuthTokenRole });

    if (state === "unbound") {
      // deliberately no principalId
    } else {
      const principal = createPrincipalRecord({ name: state });
      await principals.create(principal);
      record.principalId = principal.id;
      if (state === "bound-disabled") {
        await principals.setStatus(principal.id, { status: "disabled", reason: "test" });
      }
      if (state === "bound-missing") {
        await rm(join(dir, "principals.json"), { force: true });
      }
    }
    if (state === "revoked") {
      record.revocation = createRevocation("test");
    }
    if (state === "expired") {
      record.expiresAt = "2000-01-01T00:00:00.000Z";
    }
    await store.add(record);
    return { service, rawToken: gen.token, tokenId: gen.id };
  }

  for (const row of ROWS) {
    for (const transport of ["bearer", "cookie"] as const) {
      const expected = row[transport];
      it(`${row.state} × ${transport} → ${expected}`, async () => {
        const { service, rawToken, tokenId } = await seed(row.state);
        const result =
          transport === "bearer"
            ? await service.verifyTokenForRequest(rawToken)
            : await service.verifyPrincipalStatus(tokenId);
        assert.equal(result.ok, expected === "allow", `expected ${expected} for ${row.state}/${transport}`);
      });
    }
  }

  it("preserves role and workspace scope for an allowed bound credential", async () => {
    const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
    const service = new AuthService(store, noopAudit, noMetrics, { principalStore: principals });

    const created = await service.createToken({
      name: "scoped",
      role: "admin",
      workspaceIds: ["/ws/a"],
    });
    assert.ok(created.ok);

    // In-scope → allowed with role + principal preserved.
    const ok = await service.verifyTokenForRequest(created.value.token, "/ws/a");
    assert.ok(ok.ok);
    assert.equal(ok.value.role, "admin");
    assert.deepEqual(ok.value.workspaceIds, ["/ws/a"]);
    assert.equal(ok.value.principalId, created.value.principalId);

    // Out-of-scope → denied (workspace predicate unchanged).
    const denied = await service.verifyTokenForRequest(created.value.token, "/ws/b");
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "workspace_mismatch");
  });

  it("a disabled bound principal denies even a would-be-allowed workspace scope", async () => {
    const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
    const service = new AuthService(store, noopAudit, noMetrics, { principalStore: principals });

    const created = await service.createToken({ name: "scoped", role: "admin", workspaceIds: ["/ws/a"] });
    assert.ok(created.ok);
    await service.disablePrincipal(created.value.principalId, "test");

    const denied = await service.verifyTokenForRequest(created.value.token, "/ws/a");
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "principal_disabled");
  });
});
