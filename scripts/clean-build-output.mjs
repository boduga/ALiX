#!/usr/bin/env node
/**
 * Remove stale generated output before TypeScript compilation.
 * Without this, deleted tests survive under dist/tests and are still run.
 */
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
rmSync(output, { recursive: true, force: true });
console.log("Removed previous dist/ build output");
