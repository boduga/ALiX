import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AlixEvent, NewEvent } from "./types.js";

type EventListener = (event: AlixEvent) => void;

export class EventLog {
  readonly path: string;
  private nextSeq = 1;
  private watchers: EventListener[] = [];

  constructor(readonly sessionDir: string) {
    this.path = join(sessionDir, "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const events = await this.readAll();
    this.nextSeq = events.length + 1;
  }

  async append<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>
  ): Promise<AlixEvent<TType, TPayload>> {
    const fullEvent: AlixEvent<TType, TPayload> = {
      ...event,
      id: randomUUID(),
      seq: this.nextSeq++,
      version: 1,
      timestamp: new Date().toISOString()
    };
    await appendFile(this.path, `${JSON.stringify(fullEvent)}\n`, "utf8");
    // Notify all watchers
    for (const listener of this.watchers) {
      try { listener(fullEvent); } catch { /* ignore listener errors */ }
    }
    return fullEvent;
  }

  async readAll(): Promise<AlixEvent[]> {
    if (!existsSync(this.path)) return [];
    const text = await readFile(this.path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line) as AlixEvent]; }
        catch { return []; }
      });
  }

  async close(): Promise<void> {
    // No-op: all file operations are already complete after append
    // Keep for interface compatibility
  }

  /**
   * Watch for new events appended to the log.
   * Returns a stop function to stop watching.
   */
  watch(listener: EventListener): () => void {
    this.watchers.push(listener);
    return () => {
      this.watchers = this.watchers.filter(w => w !== listener);
    };
  }

  /**
   * Start watching the event log file for changes.
   * Calls the listener with new events as they are appended.
   * Returns a stop function.
   */
  async startWatching(listener: EventListener): Promise<() => void> {
    let position = 0;
    if (existsSync(this.path)) {
      const text = await readFile(this.path, "utf8");
      position = text.length;
    }

    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (stopped || !existsSync(this.path)) break;
        try {
          const text = await readFile(this.path, "utf8");
          if (text.length > position) {
            const newText = text.slice(position);
            position = text.length;
            for (const line of newText.split("\n").filter(Boolean)) {
              try {
                listener(JSON.parse(line) as AlixEvent);
              } catch { /* ignore parse errors */ }
            }
          }
        } catch { /* ignore read errors */ }
      }
    };

    poll(); // Start polling (non-blocking)

    return () => {
      stopped = true;
    };
  }
}
