// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { importedSpecifiers, codeOnly, toPosix } from "../helpers/import-graph.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("CAP-11 Structural Cleanup Sentinel (ruling #3, #4, #8)", () => {
  it("axis 1: APPROVED_PENDING_APPLICATION literal is gone from src/", () => {
    const files = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      expect(codeOnly(fs.readFileSync(f, "utf-8")), path.relative(REPO_ROOT, f)).not.toContain(
        "APPROVED_PENDING_APPLICATION",
      );
    }
  });

  it("axis 2: no lifecycle-overlay machinery (rehydrateLifecycleOverlay)", () => {
    const files = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      expect(codeOnly(fs.readFileSync(f, "utf-8")), path.relative(REPO_ROOT, f)).not.toMatch(
        /rehydrateLifecycleOverlay/,
      );
    }
  });

  it("axis 3: no file imports from src/evolution/capability-lifecycle/*", () => {
    const files = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      const offending = [...importedSpecifiers(f)].filter((s) => s.includes("capability-lifecycle"));
      expect(offending, path.relative(REPO_ROOT, f)).toEqual([]);
    }
  });

  it("axis 4: only CapabilityPlatform constructs CapabilityRegistry (no second CLI registry construction)", () => {
    const srcFiles = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of srcFiles) {
      if (toPosix(f).endsWith("src/capability/platform.ts")) continue;
      expect(codeOnly(fs.readFileSync(f, "utf-8")), path.relative(REPO_ROOT, f)).not.toMatch(
        /new\s+CapabilityRegistry\s*\(/,
      );
    }
  });

  it("axis 5: CapabilityPlatform.service is the sole public capability surface (no platform.registry / platform.catalog in non-test code)", () => {
    const srcFiles = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of srcFiles) {
      if (toPosix(f).endsWith("src/capability/platform.ts")) continue;
      // TUI consumer still uses platform.registry / platform.native until
      // the TUI migration lands (out of scope for CAP-11; tsc reports the
      // 3 expected privacy errors for this file).
      if (toPosix(f).endsWith("src/tui/capabilities/capability-service.ts")) continue;
      const code = codeOnly(fs.readFileSync(f, "utf-8"));
      expect(code, path.relative(REPO_ROOT, f)).not.toMatch(/platform\.registry/);
      expect(code, path.relative(REPO_ROOT, f)).not.toMatch(/platform\.catalog/);
    }
  });

  it("axis 6: CapabilityRegistry.applyLifecycleTransition removed (ruling #4)", () => {
    const registrySrc = codeOnly(
      fs.readFileSync(path.join(REPO_ROOT, "src/capability/registry.ts"), "utf-8"),
    );
    expect(registrySrc).not.toMatch(/applyLifecycleTransition/);
  });

  it("axis 7: 'capabilities' (plural) CLI command removed (ruling #6)", () => {
    const cliSrc = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src/cli.ts"), "utf-8"));
    expect(cliSrc).not.toMatch(/command\s*===\s*["']capabilities["']/);
  });
});
