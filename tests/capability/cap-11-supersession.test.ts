// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const DELETED_SOURCE_FILES = [
  "src/evolution/capability-lifecycle/index.ts",
  "src/evolution/capability-lifecycle/errors.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-applier.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-cli.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-rehydration.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts",
  "src/evolution/capability-lifecycle/capability-execution-projection.ts",
  "src/evolution/capability-lifecycle/capability-governance-bridge.ts",
  "src/evolution/capability-lifecycle/capability-proposal-builder.ts",
  "src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts",
  "src/cli/commands/capabilities.ts",
];

const DELETED_TEST_FILES = [
  "tests/evolution/capability-lifecycle/capability-execution-projection.test.ts",
  "tests/evolution/capability-lifecycle/capability-governance-bridge.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-rehydration.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts",
  "tests/evolution/capability-lifecycle/capability-cli.test.ts",
  "tests/evolution/capability-lifecycle/capability-proposal-builder.test.ts",
  "tests/evolution/capability-lifecycle/integration/a7-capability-lifecycle-integration.test.ts",
  "tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts",
  "tests/evolution/execution/capability-mutation-rollback.test.ts",
  "tests/capability/four-axis-sentinel.vitest.ts",
];

test("cap-11-supersession: A7.1 source files deleted", () => {
  for (const f of DELETED_SOURCE_FILES) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, f)),
      false,
      `${f} must be deleted after CAP-11`,
    );
  }
});

test("cap-11-supersession: A7.1 test files deleted", () => {
  for (const f of DELETED_TEST_FILES) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, f)),
      false,
      `${f} must be deleted after CAP-11`,
    );
  }
});

test("cap-11-supersession: APPROVED_PENDING_APPLICATION literal removed", () => {
  // After T1, no source file contains this literal.
  // Walk src/ for the literal; expect zero matches.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        out.push(...walk(full));
      } else if (/\.(ts|js)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };
  const files = walk(path.join(REPO_ROOT, "src"));
  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    assert.equal(
      text.includes("APPROVED_PENDING_APPLICATION"),
      false,
      `${path.relative(REPO_ROOT, f)} must not contain APPROVED_PENDING_APPLICATION`,
    );
  }
});
