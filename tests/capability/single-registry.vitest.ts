import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** AC#12 — structural composition check. The ONLY place a CapabilityRegistry
 *  is constructed is the platform composition root. This scans source (not
 *  tests) for `new CapabilityRegistry(` outside platform.ts. */
describe("exactly one canonical CapabilityRegistry per runtime universe", () => {
  const ROOT = join(process.cwd(), "src");
  const EXCLUDED = new Set(["capability/registry.ts", "capability/platform.ts"]);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const ent of readdirSync(dir)) {
      const p = join(dir, ent);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
    return out;
  }

  it("no `new CapabilityRegistry(` outside the platform composition root", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      // relative to src/ so the excluded set (capability/*) matches
      const rel = file.replace(ROOT + "/", "");
      if (EXCLUDED.has(rel)) continue;
      const src = readFileSync(file, "utf-8");
      // imports of the class are fine; construction is not
      const m = src.match(/new\s+CapabilityRegistry\s*\(/);
      if (m) offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
    }
    expect(offenders).toEqual([]);
  });
});
