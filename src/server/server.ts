import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

export function startServer(root: string, port: number): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end(await readFile(join(root, "dist", "src", "ui", "index.html"), "utf8"));
        return;
      }
      if (url.pathname === "/app.js" || url.pathname === "/styles.css") {
        const file = join(root, "dist", "src", "ui", url.pathname.slice(1));
        res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
        res.end(await readFile(file, "utf8"));
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

        // Send existing events
        const text = await readFile(eventsPath, "utf8");
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            const event = JSON.parse(line) as { seq: number };
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
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}