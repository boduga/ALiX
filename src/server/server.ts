import { existsSync } from "node:fs";
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
