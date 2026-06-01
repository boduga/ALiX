#!/usr/bin/env node
// scripts/verify-deps.mjs
// Verify all direct dependencies are pinned to exact versions.
// Fails with non-zero exit if any dep uses ^, ~, >, <, *, or x-range.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function main() {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const issues = [];

  for (const [name, version] of Object.entries(deps)) {
    const v = String(version);
    if (v.startsWith("^") || v.startsWith("~")) {
      issues.push(`  - ${name}: ${v} (caret/tilde range)`);
    } else if (/[><]/.test(v) || v.includes("*") || v.includes("x")) {
      issues.push(`  - ${name}: ${v} (range/wildcard)`);
    } else if (!/^\d+\.\d+\.\d+/.test(v)) {
      issues.push(`  - ${name}: ${v} (not a version pin)`);
    }
  }

  if (issues.length > 0) {
    console.error("❌ Supply-chain check FAILED:");
    console.error("   The following dependencies are not pinned to exact versions:\n");
    issues.forEach((i) => console.error(i));
    console.error("\n   All direct dependencies must be pinned (e.g., \"1.2.3\").");
    console.error("   This protects against supply-chain attacks via automatic minor/patch updates.");
    process.exit(1);
  }

  console.log(`✓ All ${Object.keys(deps).length} direct dependencies are pinned to exact versions.`);
}

main();