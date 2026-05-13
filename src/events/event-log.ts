import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AlixEvent, NewEvent } from "./types.js";

export class EventLog {
  readonly path: string;
  private nextSeq = 1;

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
    return fullEvent;
  }

  async readAll(): Promise<AlixEvent[]> {
    if (!existsSync(this.path)) return [];
    const text = await readFile(this.path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AlixEvent);
  }
}
