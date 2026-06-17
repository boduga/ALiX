import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  InvalidSessionIdError,
  isValidSessionId,
  readSessionComparison,
  readSessionSnapshot,
  sessionEventsPath
} from "../inspector/session-reader.js";
import { registerCoordinationRoutes } from "./coordination-routes.js";
import { handleObservabilityRoute } from "../observability/observability-routes.js";

// Event types to include in SSE stream
const VISIBLE_EVENTS = [
  // Tools
  "tool.requested", "tool.started", "tool.output", "tool.completed", "tool.failed",
  // Agent state
  "agent.message",
  // Context
  "context.repo_map_created", "context.bundle_compiled",
  // Sessions
  "session.started", "session.ended",
  // Subagents
  "subagent.started", "subagent.result",
  // Files
  "file.created",
  // Patches
  "patch.applied", "patch.rolled_back",
  // Runtime phases
  "runtime.phase.completed", "runtime.phase.started",
  // Usage
  "model.usage",
  // Ownership events (M0.75)
  "ownership.acquired", "ownership.released",
  "ownership.renewed", "ownership.expired",
  "ownership.conflict", "ownership.revoked",
  "ownership.denied",
];

function decodePathSegment(segment: string | undefined): string {
  if (!segment) return "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function rejectInvalidSessionId(res: ServerResponse): void {
  res.statusCode = 400;
  res.end("Invalid session id");
}

async function serveRegistry(res: ServerResponse, root: string, type: "agents" | "tools"): Promise<void> {
  try {
    const { loadCardRegistry } = await import("../registry/card-loader.js");
    const registry = await loadCardRegistry(root);
    res.setHeader("content-type", "application/json");
    const data = type === "agents" ? registry.listAgents(true) : registry.listTools(true);
    res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

export function startServer(root: string, host: string, port: number): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain");
        res.end("OK");
        return;
      }
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end(await readFile(join(root, "dist", "src", "ui", "index.html"), "utf8"));
        return;
      }
      if (url.pathname === "/app.js" || url.pathname === "/projection.js" || url.pathname === "/styles.css") {
        const file = join(root, "dist", "src", "ui", url.pathname.slice(1));
        res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
        if (url.pathname === "/projection.js" && !existsSync(file)) {
          res.end("export {};\n");
          return;
        }
        res.end(await readFile(file, "utf8"));
        return;
      }
      if (url.pathname === "/api/graphs") {
        try {
          const graphsDir = join(root, ".alix", "graphs");
          if (!existsSync(graphsDir)) {
            res.setHeader("content-type", "application/json");
            res.end("[]");
            return;
          }
          const files = readdirSync(graphsDir);
          const items: Array<{
            graphId: string; rootGoal?: string; status?: string; strategy?: string;
            nodeCount: number; completedNodes?: number; failedNodes?: number; blockedNodes?: number;
            updatedAt?: string; createdAt?: string; hasRuns: boolean;
          }> = [];

          for (const f of files) {
            if (!f.endsWith(".json") || f.endsWith(".runs.json")) continue;
            try {
              const raw = readFileSync(join(graphsDir, f), "utf-8");
              const graph = JSON.parse(raw);
              const graphId = f.replace(/\.json$/, "");
              const nodes: any[] = graph.nodes ?? [];
              items.push({
                graphId,
                rootGoal: graph.rootGoal,
                status: graph.status,
                strategy: graph.strategy,
                nodeCount: nodes.length,
                completedNodes: nodes.filter((n: any) => n.status === "done").length,
                failedNodes: nodes.filter((n: any) => n.status === "failed").length,
                blockedNodes: nodes.filter((n: any) => n.status === "blocked").length,
                updatedAt: graph.updatedAt,
                createdAt: graph.createdAt,
                hasRuns: existsSync(join(graphsDir, `${graphId}.runs.json`)),
              });
            } catch { console.warn("Skipping invalid graph file:", f); }
          }

          // ISO 8601 strings sort lexicographically — keep them ISO 8601
          items.sort((a, b) => {
            const byUpdated = (b.updatedAt || "").localeCompare(a.updatedAt || "");
            if (byUpdated !== 0) return byUpdated;
            return (b.createdAt || "").localeCompare(a.createdAt || "");
          });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(items));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname.startsWith("/api/graphs/") && url.pathname.endsWith("/projection")) {
        const graphId = url.pathname.split("/")[3];
        if (!graphId || graphId.length < 5) {
          res.statusCode = 400;
          res.end("Invalid graph ID");
          return;
        }
        try {
          const { buildGraphProjection } = await import("../kernel/graph-projection.js");
          const projection = await buildGraphProjection(graphId, root);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(projection));
        } catch (err) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/registry/agents") {
        await serveRegistry(res, root, "agents");
        return;
      }
      if (url.pathname === "/api/registry/tools") {
        await serveRegistry(res, root, "tools");
        return;
      }
      if (url.pathname === "/api/policy/rules") {
        try {
          const { loadRuleEvaluator } = await import("../policy/policy-loader.js");
          const evaluator = await loadRuleEvaluator(root);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(evaluator.getAllRules()));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/policy/eval") {
        try {
          const { loadRuleEvaluator } = await import("../policy/policy-loader.js");
          const capability = url.searchParams.get("capability") ?? undefined;
          const riskLevel = url.searchParams.get("risk") ?? undefined;
          const executionProfile = url.searchParams.get("profile") ?? undefined;
          const evaluator = await loadRuleEvaluator(root);
          const result = evaluator.evaluate({ capability, riskLevel: riskLevel as any, executionProfile });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/daemon/status") {
        try {
          const { DaemonManager } = await import("../daemon/daemon-manager.js");
          const mgr = new DaemonManager(root);
          const running = await mgr.isRunning();
          const status = await mgr.status();
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ running, status }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/daemon/tasks") {
        try {
          const { readFile } = await import("node:fs/promises");
          const { existsSync } = await import("node:fs");
          const { join } = await import("node:path");
          const tasksPath = join(root, ".alix", "daemon-tasks.json");
          if (!existsSync(tasksPath)) {
            res.setHeader("content-type", "application/json");
            res.end("[]");
            return;
          }
          const raw = await readFile(tasksPath, "utf-8");
          res.setHeader("content-type", "application/json");
          res.end(raw);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/approvals") {
        try {
          const { ApprovalStore } = await import("../approvals/approval-store.js");
          const store = new ApprovalStore(root);
          await store.load();
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(store.list()));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/runtime/events") {
        try {
          const { buildRuntimeIndex } = await import("../runtime/runtime-index.js");
          const idx = await buildRuntimeIndex(root);
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam ? parseInt(limitParam, 10) || 100 : 100;
          const graphParam = url.searchParams.get("graphId");
          const sessionParam = url.searchParams.get("sessionId");
          const approvalParam = url.searchParams.get("approvalId");
          const actionParam = url.searchParams.get("action");
          const orderParam = url.searchParams.get("order");
          let filtered = [...idx.events];
          if (orderParam === "asc") filtered.reverse();
          if (graphParam) filtered = filtered.filter(e => e.graphId === graphParam);
          if (sessionParam) filtered = filtered.filter(e => e.sessionId === sessionParam);
          if (approvalParam) filtered = filtered.filter(e => e.approvalId === approvalParam);
          if (actionParam) filtered = filtered.filter(e => e.action === actionParam);
          filtered = filtered.slice(0, limit);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(filtered));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/audit") {
        try {
          const { AuditStore } = await import("../audit/audit-store.js");
          const store = new AuditStore(root);
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam ? parseInt(limitParam, 10) || 100 : 100;
          const actionParam = url.searchParams.get("action");
          const graphParam = url.searchParams.get("graphId");
          let records;
          if (actionParam) records = await store.findByAction(actionParam as any, limit);
          else if (graphParam) records = await store.findByGraph(graphParam, limit);
          else records = await store.list(limit);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(records));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/sessions/compare") {
        const left = url.searchParams.get("left");
        const right = url.searchParams.get("right");
        if (!left || !right) {
          res.statusCode = 400;
          res.end("Missing left or right session id");
          return;
        }
        if (!isValidSessionId(left) || !isValidSessionId(right)) {
          rejectInvalidSessionId(res);
          return;
        }

        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await readSessionComparison(root, left, right)));
        return;
      }
      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/snapshot")) {
        const sessionId = decodePathSegment(url.pathname.split("/")[3]);
        if (!isValidSessionId(sessionId)) {
          rejectInvalidSessionId(res);
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await readSessionSnapshot(root, sessionId)));
        return;
      }
      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/events")) {
        const sessionId = decodePathSegment(url.pathname.split("/")[3]);
        if (!isValidSessionId(sessionId)) {
          rejectInvalidSessionId(res);
          return;
        }
        const eventsPath = sessionEventsPath(root, sessionId);

        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache");
        res.setHeader("connection", "keep-alive");

        if (!existsSync(eventsPath)) {
          res.end();
          return;
        }

        // Honor Last-Event-ID for cursor-based resume on reconnect
        const rawResumeId = req.headers["last-event-id"];
        const resumeFromSeq = parseInt(Array.isArray(rawResumeId) ? rawResumeId[0] : (rawResumeId ?? "0"), 10);

        // Send existing events from resume cursor
        const text = await readFile(eventsPath, "utf8");
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            const event = JSON.parse(line) as { seq: number; type: string };
            if (event.seq <= resumeFromSeq) continue;
            // Only emit tool events to SSE
            if (!VISIBLE_EVENTS.includes(event.type)) continue;
            res.write(`event: alix\nid: ${event.seq}\ndata: ${line}\n\n`);
          } catch {
            // Skip malformed lines
          }
        }

        // Poll for new events
        let lastSize = (await readFile(eventsPath, "utf8")).length;
        const interval = setInterval(async () => {
          if (!existsSync(eventsPath)) {
            clearInterval(interval);
            res.end();
            return;
          }
          try {
            const currentSize = (await readFile(eventsPath, "utf8")).length;
            if (currentSize > lastSize) {
              const newText = (await readFile(eventsPath, "utf8")).slice(lastSize);
              lastSize = currentSize;
              for (const line of newText.split("\n").filter(Boolean)) {
                try {
                  const event = JSON.parse(line) as { seq: number; type: string };
                  // Only emit tool events to SSE
                  if (!VISIBLE_EVENTS.includes(event.type)) continue;
                  res.write(`event: alix\nid: ${event.seq}\ndata: ${line}\n\n`);
                } catch {
                  // Skip malformed lines
                }
              }
            }
          } catch {
            clearInterval(interval);
            res.end();
          }
        }, 500);

        req.on("close", () => {
          clearInterval(interval);
        });

        return;
      }
      if (url.pathname.startsWith("/api/observability")) {
        const handled = await handleObservabilityRoute({ req, res, root });
        if (handled) return;
      }
      if (registerCoordinationRoutes(root, req.method ?? "GET", url.pathname, res)) {
        return;
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      if (error instanceof InvalidSessionIdError) {
        rejectInvalidSessionId(res);
        return;
      }
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : "Internal server error");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://${host}:${address.port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}
