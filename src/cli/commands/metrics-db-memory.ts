/**
 * `alix db / memory / metrics` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { join, resolve } from "node:path";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";
import type { MemoryType } from "../../utils/memory/types.js";

const MEMORY_TYPES = new Set<MemoryType>(["user", "project", "feedback", "reference"]);

export async function handleMetricsRoot(args: string[]): Promise<void> {
  const { readSessionEvents } = await import("../../inspector/session-reader.js");
  const sessionsDir = join(process.cwd(), ".alix", "sessions");
  const { readdir, stat } = await import("node:fs/promises");

  // Support --session <id>
  const sessionIdx = args.indexOf("--session");
  const sessionArg = sessionIdx >= 0 && args[sessionIdx + 1] ? args[sessionIdx + 1] : null;
  let targetSession: string;

  if (sessionArg) {
    targetSession = sessionArg;
  } else {
    // Find newest by mtime
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = (await Promise.all(
      entries.filter(d => d.isDirectory()).map(async d => {
        const p = join(sessionsDir, d.name);
        const s = await stat(p);
        return { name: d.name, mtimeMs: s.mtimeMs };
      })
    )).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (dirs.length === 0) { console.log("No sessions found."); process.exit(0); }
    targetSession = dirs[0].name;
  }

  const events = await readSessionEvents(process.cwd(), targetSession);
  const metricEvents = events.filter((e: any) => e.type === "observability.metric" || e.type === "m09.metric");
  if (metricEvents.length === 0) { console.log(`No metrics for session ${targetSession}.`); process.exit(0); }
  console.log(`Session: ${targetSession}`);
  console.log();

  const isRaw = args.includes("--raw");

  if (isRaw) {
    // Raw mode: one line per event
    for (const ev of metricEvents) {
      const p = ev.payload as any;
      console.log(`  ${p.name}: ${p.value}${p.labels ? ` ${JSON.stringify(p.labels)}` : ""}`);
    }
  } else {
    // Summary mode: group by name. Counters sum deltas, timers collect
    // samples, gauges keep the latest observation (a gauge summed as a
    // counter would be meaningless).
    const counters: Record<string, number> = {};
    const timers: Record<string, number[]> = {};
    const gauges: Record<string, { value: number; labels?: Record<string, string> }> = {};
    for (const ev of metricEvents) {
      const p = ev.payload as any;
      if (p.type === "timer") {
        if (!timers[p.name]) timers[p.name] = [];
        timers[p.name].push(p.value);
      } else if (p.type === "gauge") {
        gauges[p.name] = { value: p.value, labels: p.labels };
      } else {
        counters[p.name] = (counters[p.name] ?? 0) + p.value;
      }
    }
    if (Object.keys(counters).length > 0) {
      console.log("Counters:");
      for (const [name, total] of Object.entries(counters).sort()) {
        console.log(`  ${name}: ${total}`);
      }
      console.log();
    }
    if (Object.keys(timers).length > 0) {
      console.log("Timers:");
      for (const [name, values] of Object.entries(timers).sort()) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        console.log(`  ${name}: ${Math.round(avg)}ms (avg, ${values.length} samples)`);
      }
      console.log();
    }
    if (Object.keys(gauges).length > 0) {
      console.log("Gauges:");
      for (const [name, g] of Object.entries(gauges).sort()) {
        console.log(`  ${name}: ${g.value}${g.labels ? ` ${JSON.stringify(g.labels)}` : ""} (latest)`);
      }
      console.log();
    }
    console.log(`Raw view: alix metrics --session ${targetSession} --raw`);
  }
  process.exit(0);
}

export async function handleDbRoot(args: string[]): Promise<void> {
  const { DatabaseManager } = await import("../../db/manager.js");
  const db = new DatabaseManager();

  if (args[0] === "migrate") {
    db.open();
    db.migrateKernel();
    const health = db.health();
    console.log(`Migrated. Tables: ${health.tables.length}`);
    db.close();
    process.exit(0);
  }

  if (args[0] === "doctor") {
    db.open();
    const health = db.health();
    if (health.ok) {
      console.log("Database: healthy");
      console.log(`Tables (${health.tables.length}): ${health.tables.join(", ")}`);
    } else {
      console.error(`Database: unhealthy — ${health.error}`);
      process.exit(1);
    }
    db.close();
    process.exit(0);
  }

  console.error("Usage: alix db migrate | alix db doctor");
  process.exit(1);
}

export async function handleMemoryRoot(args: string[]): Promise<void> {
  const memoryDir = resolve(process.cwd(), ".alix/memory");
  const { MemoryStore } = await import("../../utils/memory/store.js");
  const sub = args[0];

  if (sub === "list") {
    const queryIdx = args.indexOf("--query");
    const query = queryIdx !== -1 ? args.slice(queryIdx + 1).join(" ") : args.slice(1).join(" ");
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 20);
    if (results.length === 0) {
      console.log("No memory entries found.");
    } else {
      for (const entry of results) {
        console.log(`[${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
        console.log(`  ${entry.content.slice(0, 100)}${entry.content.length > 100 ? "..." : ""}`);
        console.log();
      }
    }
  } else if (sub === "add") {
    const nameIdx = args.indexOf("--name");
    const typeIdx = args.indexOf("--type");
    const contentIdx = args.indexOf("--content");
    const descIdx = args.indexOf("--description");

    const name = nameIdx !== -1 ? args[nameIdx + 1] : null;
    const type = typeIdx !== -1 ? args[typeIdx + 1] : "project";
    const content = contentIdx !== -1 ? args[contentIdx + 1] : null;
    const description = descIdx !== -1 ? args[descIdx + 1] ?? "" : "";

    if (!name || !content) {
      console.error("Usage: alix memory add --name <name> --content <content> [--type <type>] [--description <desc>]");
      process.exit(1);
    }
    if (!MEMORY_TYPES.has(type as MemoryType)) {
      console.error("Invalid memory type. Expected one of: user, project, feedback, reference.");
      process.exit(1);
    }

    const store = new MemoryStore(memoryDir);
    await store.init();
    await store.save({
      name,
      description,
      type: type as MemoryType,
      content,
      confidence: 0.7,
      confirmations: 1,
    });
    await store.buildIndex();
    console.log("Memory entry saved.");
  } else if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: alix memory search <query>");
      process.exit(1);
    }
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 10);
    console.log(`Found ${results.length} entries:`);
    for (const entry of results) {
      console.log(`  [${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
    }
  } else if (sub === "stats") {
    const { readdir } = await import("node:fs/promises");
    const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];
    for (const dir of dirs) {
      const files = await readdir(join(memoryDir, dir)).catch(() => []);
      console.log(`${dir}: ${files.length} entries`);
    }
  } else {
    console.log("Usage: alix memory [list|add|search|stats]");
    console.log("  list [--query <text>]  - List memory entries, optionally filter by query");
    console.log("  add --name <n> --content <c> [--type <t>] [--description <d>] - Add a memory entry");
    console.log("  search <query>         - Search memory entries");
    console.log("  stats                  - Show memory statistics");
  }
  process.exit(0);
}

