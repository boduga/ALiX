import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const SCRIPTS = join(process.cwd(), "skills", "langfuse-traces", "scripts");
const CREDS = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };

const ROWS = [
  { id: "o1", traceId: "t1", sessionId: "s", type: "SPAN", name: "do the thing", level: "DEFAULT", startTime: "2026-09-11T16:00:00.000Z", endTime: "2026-09-11T16:05:00.000Z" },
  { id: "o2", traceId: "t1", sessionId: "s", type: "SPAN", name: "file.read", level: "DEFAULT", startTime: "2026-09-11T16:01:00.000Z", endTime: "2026-09-11T16:01:01.000Z" },
  { id: "o3", traceId: "t2", sessionId: "s", type: "SPAN", name: "do the thing", level: "DEFAULT", startTime: "2026-09-11T16:00:00.000Z", endTime: "2026-09-11T16:04:00.000Z" },
  { id: "o4", traceId: "t2", sessionId: "s", type: "SPAN", name: "file.read", level: "DEFAULT", startTime: "2026-09-11T16:01:00.000Z", endTime: "2026-09-11T16:01:01.000Z" },
  { id: "o5", traceId: "t3", sessionId: "s", type: "SPAN", name: "other", level: "ERROR", statusMessage: "denied", startTime: "2026-09-11T16:01:00.000Z", endTime: "2026-09-11T16:01:01.000Z" },
];

let server: Server;
let baseUrl: string;
let tmp: string;

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return execFileAsync(process.execPath, [join(SCRIPTS, script), ...args], {
    env: { ...process.env, ...CREDS, ...env },
    timeout: 30_000,
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "loop-scripts-"));
  mkdirSync(join(tmp, "sessions", "s1"), { recursive: true });
  const usage = (runId: string, ts: string, input: number, output: number, model = "glm-flash") =>
    JSON.stringify({ type: "model.usage", timestamp: ts, runId, payload: { provider: "z", model, inputTokens: input, outputTokens: output, durationMs: 1000 } });
  const lines = [
    ...Array.from({ length: 10 }, (_, i) => usage(`run-${i}`, `2026-09-10T10:${String(i).padStart(2, "0")}:00Z`, 100, 50)),
    usage("run-spike", "2026-09-10T11:00:00Z", 4000, 2000),
    "GARBAGE-LINE",
  ];
  writeFileSync(join(tmp, "sessions", "s1", "events.jsonl"), lines.join("\n"));
  const led = (id: string, v: number) => JSON.stringify({ traceId: id, name: "quality", value: v });
  writeFileSync(join(tmp, "ledger.jsonl"), ["t1", "t2"].map((t) => led(t, 0.9)).join("\n") + "\n" + led("t3", 0.2));
  writeFileSync(join(tmp, "base.jsonl"),
    Array.from({ length: 20 }, (_, i) => led(`t${i}`, i % 2 === 0 ? 0.9 : 0.3)).join("\n"));
  writeFileSync(join(tmp, "cand.jsonl"),
    Array.from({ length: 20 }, (_, i) => led(`t${i}`, i < 16 ? 0.95 : 0.3)).join("\n"));

  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && u.pathname.endsWith("/api/public/v2/observations")) {
      const tid = u.searchParams.get("traceId");
      const data = tid ? ROWS.filter((r) => r.traceId === tid) : ROWS;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data, meta: { totalItems: data.length } }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (u.pathname.endsWith("/api/public/prompts")) {
        const b = JSON.parse(body);
        res.end(JSON.stringify({ id: "p1", name: b.name, version: 2, labels: b.labels }));
      } else {
        res.end(JSON.stringify({ id: "id-1" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("loop scripts (stub gateway + fixture sessions)", () => {
  it("query.mjs lists grouped traces and inspects one", async () => {
    const list = await run("query.mjs", ["--list", "--base-url", baseUrl]);
    expect(list.stdout).toMatch("t1  do the thing");
    const one = await run("query.mjs", ["--trace-id", "t3", "--json", "--base-url", baseUrl]);
    const parsed = JSON.parse(one.stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.summary.errors[0].name).toBe("other");
  });

  it("query.mjs fails open without creds", async () => {
    const r = await execFileAsync(process.execPath,
      [join(SCRIPTS, "query.mjs"), "--list", "--base-url", baseUrl],
      { env: { ...process.env, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" } });
    expect(JSON.parse(r.stdout).status).toBe("unavailable");
  });

  it("digest.mjs aggregates a window plus the cost section", async () => {
    const r = await run("digest.mjs",
      ["--hours", "24", "--sessions-dir", join(tmp, "sessions"), "--base-url", baseUrl]);
    expect(r.stdout).toMatch("traces: 3 (1 with errors)");
    expect(r.stdout).toMatch("## cost rollup");
    expect(r.stdout).toMatch("run-spike");
  });

  it("cost-rollup.mjs flags spikes and gates evidence", async () => {
    const r = await run("cost-rollup.mjs", ["--sessions-dir", join(tmp, "sessions"), "--min-runs", "5"]);
    expect(r.stdout).toMatch("run-spike");
    expect(r.stdout).toMatch("glm-flash: 11 runs");
  });

  it("score.mjs writes, validates, and batches", async () => {
    const one = await run("score.mjs", ["--trace-id", "t1", "--value", "0.9", "--base-url", baseUrl]);
    expect(JSON.parse(one.stdout).status).toBe("ok");
    const bad = await run("score.mjs", ["--trace-id", "t1", "--value", "7", "--base-url", baseUrl]);
    expect(JSON.parse(bad.stdout).status).toBe("partial");
  });

  it("mine.mjs groups shared tool sequences", async () => {
    const r = await run("mine.mjs",
      ["--scores", join(tmp, "ledger.jsonl"), "--min-runs", "2", "--base-url", baseUrl]);
    expect(r.stdout).toMatch("1 candidates");
    expect(r.stdout).toMatch("file.read");
  });

  it("corpus.mjs appends only error traces", async () => {
    const r = await run("corpus.mjs", ["--dataset-id", "ds", "--json", "--base-url", baseUrl]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe("ok");
    expect(parsed.appended).toEqual(["t3"]);
  });

  it("prompt.mjs creates a labelled version", async () => {
    const r = await run("prompt.mjs",
      ["--create", "--name", "p", "--text", "hi", "--label", "champion", "--base-url", baseUrl]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe("ok");
    expect(parsed.labels).toEqual(["champion"]);
  });

  it("eval-gate.mjs returns promote/block/insufficient", async () => {
    const pro = await run("eval-gate.mjs",
      ["--baseline", join(tmp, "base.jsonl"), "--candidate", join(tmp, "cand.jsonl"), "--json"]);
    expect(JSON.parse(pro.stdout).verdict).toBe("promote");
    const blk = await run("eval-gate.mjs",
      ["--baseline", join(tmp, "cand.jsonl"), "--candidate", join(tmp, "base.jsonl"), "--json"]);
    expect(JSON.parse(blk.stdout).verdict).toBe("block");
  });

  it("probe-writes.mjs passes all four probes against the stub", async () => {
    const r = await run("probe-writes.mjs", ["--trace-id", "t1", "--base-url", baseUrl]);
    expect(r.stdout).toMatch("[PASS] scores write");
    expect(r.stdout).toMatch("[PASS] dataset create");
    expect(r.stdout).toMatch("[PASS] dataset item append");
    expect(r.stdout).toMatch("[PASS] prompt create");
  });
});
