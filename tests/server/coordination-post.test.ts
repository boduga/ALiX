import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { registerCoordinationRoutes, cancelAllBackgroundRuns } from "../../src/server/coordination-routes.js";

function mockRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { res.headers[k] = v; },
    end(body: string) { chunks.push(body); res.done = true; },
    done: false,
  };
  return { res, body: () => JSON.parse(chunks.join("")) };
}

function mockReq(payload: unknown) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Readable.from([data]) as any;
}

describe("coordination POST routes", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-post-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("routes POST /api/coordination/run", () => {
    const { res } = mockRes();
    const handled = registerCoordinationRoutes(cwd, "POST", "/api/coordination/run", res, null, undefined, mockReq({}));
    assert.equal(handled, true);
  });

  it("rejects a missing goal without planning", async () => {
    const { res, body } = mockRes();
    registerCoordinationRoutes(cwd, "POST", "/api/coordination/run", res, null, undefined, mockReq({}));
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(res.statusCode, 400);
    assert.equal(body().error, "invalid_goal");
  });

  it("rejects an invalid session mode", async () => {
    const { res, body } = mockRes();
    registerCoordinationRoutes(cwd, "POST", "/api/coordination/run", res, null, undefined, mockReq({ goal: "x", sessionMode: "nope" }));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(res.statusCode, 400);
    assert.equal(body().error, "invalid_session_mode");
  });

  it("rejects malformed JSON", async () => {
    const { res, body } = mockRes();
    registerCoordinationRoutes(cwd, "POST", "/api/coordination/run", res, null, undefined, mockReq("{bad json"));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(res.statusCode, 400);
    assert.equal(body().error, "invalid_json");
  });

  it("cancel on an unknown run is idempotent", async () => {
    const { res, body } = mockRes();
    registerCoordinationRoutes(cwd, "POST", "/api/coordination/coord_missing/cancel", res, null, undefined, mockReq({}));
    for (let i = 0; i < 100 && !res.done; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(res.statusCode, 200);
    assert.equal(body().cancelled, true);
  });

  it("rejects path traversal run ids", async () => {
    const { res, body } = mockRes();
    const handled = registerCoordinationRoutes(cwd, "POST", "/api/coordination/../cancel", res, null, undefined, mockReq({}));
    assert.equal(handled, true);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(res.statusCode, 400);
    assert.equal(body().error, "invalid_run_id");
  });
});

describe("cancelAllBackgroundRuns", () => {
  it("resolves with no in-flight runs", async () => {
    await assert.doesNotReject(() => cancelAllBackgroundRuns());
  });

  it("is idempotent", async () => {
    await cancelAllBackgroundRuns();
    await cancelAllBackgroundRuns();
  });
});
