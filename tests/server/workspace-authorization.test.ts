import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { AuthStore, createTokenRecord, type StoredToken } from "../../src/governance/security/inspector/auth-store.js";
import { AuthService } from "../../src/governance/security/inspector/auth-service.js";
import { generateToken } from "../../src/governance/security/inspector/token-format.js";
import { BrowserSessionStore } from "../../src/governance/security/inspector/browser-session-store.js";
import { RoutePolicyRegistry } from "../../src/governance/security/inspector/route-policy.js";
import { SecretDetector } from "../../src/governance/security/redaction/secret-detector.js";
import { createSecurityMiddleware } from "../../src/interfaces/server/security-middleware.js";
import { startServer } from "../../src/interfaces/server/server.js";
import { setStateDirOverride, clearStateDirOverride, getUserStatePaths } from "../../src/governance/security/platform/user-state-paths.js";

// Literal expected outcomes; intentionally independent of production scope/role helpers.
const PARITY = [
  { scope: undefined, read: 200, execute: [200, 200, 403] },
  { scope: [], read: 401, execute: [401, 401, 401] },
  { scope: ["/workspace"], read: 200, execute: [200, 200, 403] },
  { scope: ["/other"], read: 401, execute: [401, 401, 401] },
];
const roles = ["admin", "operator", "readonly"] as const;
const transports = ["bearer", "cookie"] as const;

describe("Inspector workspace authorization parity", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(join(tmpdir(), "alix-workspace-parity-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  async function harness(enforceAuth: boolean, withService = true) {
    const storeFile = join(dir, `${randomUUID()}.json`);
    const store = new AuthStore({ filePath: storeFile });
    const writer = new AuthStore({ filePath: storeFile });
    const service = new AuthService(store, () => {}, () => {});
    const sessions = new BrowserSessionStore();
    const registry = new RoutePolicyRegistry();
    for (const [path, permission] of [["/read", "graphs:read"], ["/execute", "coordination:execute"]]) {
      registry.register({ id: path, method: "GET", pathPattern: path, pathType: "exact",
        auth: "authenticated", permission, routeClass: "data", redactionProfile: "operational", streaming: false });
    }
    registry.register({ id: "post-read", method: "POST", pathPattern: "/read", pathType: "exact",
      auth: "authenticated", permission: "graphs:read", routeClass: "data", redactionProfile: "operational", streaming: false });
    registry.register({ id: "api.approvals.decision", method: "POST", pathPattern: "/api/approvals/:id/decision", pathType: "pattern",
      auth: "authenticated", permission: "approvals:decide", routeClass: "data", redactionProfile: "operational", streaming: false });
    const middleware = createSecurityMiddleware({ host: "127.0.0.1", registry,
      detector: new SecretDetector(), enforceAuth, authService: withService ? service : undefined,
      sessionStore: sessions, targetWorkspace: "/workspace" });
    let remoteDecisionHandlerCalls = 0;
    const server = createServer(async (req, res) => {
      const ctx = await middleware(req, res);
      if (ctx) {
        if (req.url?.startsWith("/api/approvals/") && req.url.endsWith("/decision")) {
          remoteDecisionHandlerCalls++;
        }
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify(ctx));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}`;
    async function credential(scope: string[] | undefined, role: string, transport: string) {
      const generated = generateToken();
      assert.ok((await writer.add(createTokenRecord({ ...generated, name: "parity", role, workspaceIds: scope }))).ok);
      const session = sessions.createSession({ id: generated.id, name: "parity", role, workspaceIds: scope, permissions: ["graphs:read", "coordination:execute"] });
      const headers = transport === "bearer" ? { authorization: `Bearer ${generated.token}` } : { cookie: `alix-session=${session.id}` };
      return { id: generated.id, headers, session };
    }
    return { url, writer, credential, sessions,
      get remoteDecisionHandlerCalls() { return remoteDecisionHandlerCalls; },
      close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(err => err ? reject(err) : resolve()); }) };
  }

  for (const enforceAuth of [true, false]) {
    for (const transport of transports) for (const [roleIndex, role] of roles.entries()) {
      for (const row of PARITY) {
        it(`${enforceAuth ? "required" : "development"} ${transport} ${role} scope=${JSON.stringify(row.scope)}`, async () => {
          const h = await harness(enforceAuth);
          try {
            const c = await h.credential(row.scope, role, transport);
            const read = await fetch(`${h.url}/read`, { headers: c.headers });
            assert.equal(read.status, row.read);
            if (read.status === 200) {
              const ctx = await read.json() as { workspaceIds?: string[]; authenticated: boolean };
              assert.deepEqual(ctx.workspaceIds, row.scope);
              assert.equal(ctx.authenticated, true);
            }
            const execute = await fetch(`${h.url}/execute`, { headers: c.headers });
            // Development keeps existing role bypass; workspace restrictions still apply.
            const expected = !enforceAuth && row.read === 200 ? 200 : row.execute[roleIndex];
            assert.equal(execute.status, expected);
          } finally { await h.close(); }
        });
      }
    }
  }

  for (const transport of transports) for (const enforceAuth of [true, false]) {
    for (const [name, update] of [
      ["revoked", { revocation: { revokedAt: "2000-01-01T00:00:00.000Z", reason: "test" } }],
      ["expired", { expiresAt: "2000-01-01T00:00:00.000Z" }],
      ["scope removed", { workspaceIds: [] }],
      ["scope changed", { workspaceIds: ["/other"] }],
    ] as const) {
      it(`${transport} ${enforceAuth} revalidates ${name} through separate store`, async () => {
        const h = await harness(enforceAuth);
        try {
          const c = await h.credential(["/workspace"], "admin", transport);
          assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 200);
          assert.ok((await h.writer.update(c.id, update as Partial<StoredToken>)).ok);
          assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 401);
          assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 401, "removed session must not fall back to dev anonymous access");
        } finally { await h.close(); }
      });
    }
  }

  for (const enforceAuth of [true, false]) {
    for (const transport of transports) for (const role of roles) {
      for (const scope of [undefined, [], ["/other"]] as const) {
        it(`remote decision maps ${JSON.stringify(scope)} workspace denial to 403 (${enforceAuth ? "required" : "development"}, ${transport}, ${role})`, async () => {
          const h = await harness(enforceAuth);
          try {
            const c = await h.credential(scope === undefined ? undefined : [...scope], role, transport);
            const response = await fetch(`${h.url}/api/approvals/apr-1/decision`, {
              method: "POST",
              headers: { ...c.headers, "content-type": "application/json" },
              body: JSON.stringify({ decision: "approved", nonce: "scope-parity" }),
            });
            assert.equal(response.status, 403);
            const body = await response.json() as { error?: string };
            assert.equal(body.error, "workspace_scope_required");
            assert.equal(h.remoteDecisionHandlerCalls, 0, "denial must happen before the route handler can read approval state");
          } finally { await h.close(); }
        });
      }
    }
  }

  for (const transport of transports) {
    it(`${transport} rejects malformed stored scope instead of substring matching`, async () => {
      const h = await harness(true);
      try {
        const c = await h.credential(["/workspace"], "operator", transport);
        // AuthStore reads JSON records; runtime scope shape must fail closed.
        assert.ok((await h.writer.update(c.id, { workspaceIds: JSON.parse('"prefix/workspace/suffix"') })).ok);
        assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 401);
      } finally { await h.close(); }
    });
  }

  it("cookie permissions follow current role instead of cached admin snapshot", async () => {
    const h = await harness(true);
    try {
      const c = await h.credential(["/workspace"], "admin", "cookie");
      assert.ok((await h.writer.update(c.id, { role: "readonly" })).ok);
      assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 200);
      assert.equal((await fetch(`${h.url}/execute`, { headers: c.headers })).status, 403);
    } finally { await h.close(); }
  });

  it("cookie without source validation fails closed even in development", async () => {
    const h = await harness(false, false);
    try {
      const c = await h.credential(["/workspace"], "admin", "cookie");
      assert.equal((await fetch(`${h.url}/read`, { headers: c.headers })).status, 401);
    } finally { await h.close(); }
  });

  for (const [mode, expected] of [[true, 401], [false, 200]] as const) {
    it(`anonymous ordinary access preserves mode=${mode}`, async () => {
      const h = await harness(mode);
      try { assert.equal((await fetch(`${h.url}/read`)).status, expected); }
      finally { await h.close(); }
    });
  }

  it("request query/header/body cannot replace configured workspace", async () => {
    const h = await harness(true);
    try {
      const c = await h.credential(["/other"], "operator", "bearer");
      const r = await fetch(`${h.url}/read?workspace=/other&workspaceId=/other`, {
        headers: { ...c.headers, "x-workspace-id": "/other", "x-workspace": "/other" },
      });
      assert.equal(r.status, 401);
      const posted = await fetch(`${h.url}/read`, {
        method: "POST", headers: { ...c.headers, "content-type": "application/json" },
        body: JSON.stringify({ workspace: "/other", workspaceId: "/other", workspaceIds: ["/other"] }),
      });
      assert.equal(posted.status, 401);
    } finally { await h.close(); }
  });
});

describe("Inspector canonical server root", () => {
  it("rejects nonexistent root before initializing stores", async () => {
    await assert.rejects(async () => startServer(join(tmpdir(), randomUUID()), "127.0.0.1", 0));
  });

  it("relative, dot-segment, absolute and symlink roots use the same token identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-canonical-server-"));
    const root = join(dir, "project");
    const alias = join(dir, "alias");
    await mkdir(root);
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    setStateDirOverride(dir);
    try {
      const state = getUserStatePaths();
      await mkdir(state.authStateDir, { recursive: true });
      const store = new AuthStore({ filePath: join(state.authStateDir, "auth-store.json") });
      const generated = generateToken();
      assert.ok((await store.add(createTokenRecord({ ...generated, name: "canonical", role: "readonly", workspaceIds: [realpathSync.native(root)] }))).ok);
      for (const input of [root, relative(process.cwd(), root), `${root}/../project`, alias]) {
        const server = await startServer(input, "127.0.0.1", 0, undefined, undefined, undefined, "required");
        try {
          assert.equal((await fetch(`${server.url}/api/graphs`, { headers: { authorization: `Bearer ${generated.token}` } })).status, 200);
        } finally { await server.close(); }
      }
    } finally { clearStateDirOverride(); await rm(dir, { recursive: true, force: true }); }
  });
});
