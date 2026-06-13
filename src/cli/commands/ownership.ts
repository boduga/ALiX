/**
 * ownership.ts — CLI commands for lease-based ownership management.
 *
 * Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>
 *
 * All operations use the public async OwnershipRegistry API.
 */

import { OwnershipRegistry } from "../../ownership/ownership-registry.js";
import { normalizePathScope, formatScope } from "../../ownership/path-scope.js";

export async function handleOwnershipCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    console.error("Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const reg = new OwnershipRegistry(cwd);

  switch (sub) {
    case "list": {
      const records = await reg.listActive();
      if (records.length === 0) { console.log("No active ownership records."); return; }
      console.log("STATUS  AGENT".padEnd(32) + "MODE".padEnd(20) + "SCOPE".padEnd(50) + "TTL");
      for (const r of records) {
        const scope = formatScope(r.scope);
        const ttl = new Date(r.expiresAt).getTime() - Date.now();
        const ttlStr = ttl > 0 ? `${Math.round(ttl / 60000)}m` : "expired";
        console.log(`ACTIVE  ${r.agentId.padEnd(22)} ${r.mode.padEnd(18)} ${scope.padEnd(48)} ${ttlStr}`);
      }
      break;
    }

    case "history": {
      const records = await reg.listHistory();
      if (records.length === 0) { console.log("No history records."); return; }
      for (const r of records) {
        const scope = formatScope(r.scope);
        console.log(`${r.status.padEnd(10)} ${r.agentId.padEnd(22)} ${r.mode.padEnd(18)} ${scope}`);
      }
      break;
    }

    case "show": {
      const id = args[1];
      if (!id) { console.error("Usage: alix ownership show <id>"); process.exit(1); }
      await reg.refresh();
      const record = reg.get(id);
      if (!record) { console.error(`Record not found: ${id}`); process.exit(1); }
      console.log(JSON.stringify(record, null, 2));
      break;
    }

    case "acquire": {
      const agentIdx = args.indexOf("--agent");
      const pathIdx = args.indexOf("--path");
      const modeIdx = args.indexOf("--mode");
      const agentId = agentIdx >= 0 ? args[agentIdx + 1] : "cli-user";
      const pattern = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
      const modeRaw = modeIdx >= 0 ? args[modeIdx + 1] : "exclusive-write";
      // Validate mode
      if (!["exclusive-write", "shared-read", "review-only"].includes(modeRaw)) {
        console.error("Invalid mode. Allowed: exclusive-write, shared-read, review-only");
        process.exit(1);
      }
      const mode = modeRaw as "exclusive-write" | "shared-read" | "review-only";
      if (!pattern) {
        console.error("Usage: alix ownership acquire --agent <id> --path <scope> --mode <mode>");
        process.exit(1);
      }
      const scope = normalizePathScope(pattern, cwd);
      const result = await reg.acquire({
        agentId,
        scope,
        mode,
        reason: "cli-acquire",
      });
      if (!result.acquired) {
        console.error(`Conflict: ${result.conflict?.reason ?? "lock timeout"}`);
        process.exit(1);
      }
      console.log(`Acquired: ${result.record!.id} (${mode}) on ${formatScope(scope)}`);
      break;
    }

    case "release": {
      const id = args[1];
      if (!id) { console.error("Usage: alix ownership release <id>"); process.exit(1); }
      const released = await reg.release(id);
      if (released) { console.log(`Released: ${id}`); }
      else { console.error(`Failed to release: ${id}`); process.exit(1); }
      break;
    }

    case "renew": {
      const id = args[1];
      const ttlIdx = args.indexOf("--ttl");
      const ttlArg = ttlIdx >= 0 ? args[ttlIdx + 1] : undefined;
      if (ttlIdx >= 0 && !ttlArg) {
        console.error("--ttl requires a value. Use e.g. 30m, 2h, 300s");
        process.exit(1);
      }
      const ttlMs = ttlArg ? parseTTL(ttlArg) : undefined;
      if (!id) { console.error("Usage: alix ownership renew <id> [--ttl 30m]"); process.exit(1); }
      const renewed = await reg.renew(id, ttlMs);
      if (renewed) { console.log(`Renewed: ${id}`); }
      else { console.error(`Failed to renew: ${id}`); process.exit(1); }
      break;
    }

    case "conflicts": {
      const pathIdx = args.indexOf("--path");
      const pattern = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
      if (!pattern) { console.error("Usage: alix ownership conflicts --path <pattern>"); process.exit(1); }
      const conflicts = await reg.findConflictsByPattern(pattern);
      if (conflicts.length === 0) { console.log("No conflicts found."); return; }
      console.log(`Conflicts for ${pattern}:`);
      for (const c of conflicts) {
        console.log(`  ${c.agentId} ${c.mode} — ${formatScope(c.scope)}`);
      }
      break;
    }

    case "prune": {
      const count = await reg.prune();
      console.log(`Pruned ${count} expired records.`);
      break;
    }

    default:
      console.error("Unknown ownership subcommand: " + sub);
      console.error("Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>");
      process.exit(1);
  }
}

function parseTTL(s: string): number {
  const m = s.match(/^(\d+)([smh])$/);
  if (!m) {
    console.error("Invalid TTL format. Use e.g. 30m, 2h, 300s");
    process.exit(1);
  }
  const n = parseInt(m[1], 10);
  if (n <= 0) {
    console.error("TTL must be positive");
    process.exit(1);
  }
  if (m[2] === "s") return n * 1000;
  if (m[2] === "m") return n * 60 * 1000;
  return n * 3600 * 1000; // h
}
