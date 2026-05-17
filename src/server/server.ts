import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { readSessionComparison, readSessionSnapshot } from "../inspector/session-reader.js";

export function startServer(root: string, host: string, port: number): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
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
      if (url.pathname === "/api/sessions/compare") {
        const left = url.searchParams.get("left");
        const right = url.searchParams.get("right");
        if (!left || !right) {
          res.statusCode = 400;
          res.end("Missing left or right session id");
          return;
        }

        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await readSessionComparison(root, left, right)));
        return;
      }
      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/snapshot")) {
        const sessionId = url.pathname.split("/")[3];
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await readSessionSnapshot(root, sessionId)));
        return;
      }
      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/events")) {
        const sessionId = url.pathname.split("/")[3];
        const eventsPath = join(root, ".alix", "sessions", sessionId, "events.jsonl");

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
            const event = JSON.parse(line) as { seq: number };
            if (event.seq <= resumeFromSeq) continue;
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
                  const event = JSON.parse(line) as { seq: number };
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
