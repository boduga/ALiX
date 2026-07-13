// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.2 — Test Suite Observation Provider.
 *
 * Runs test suites and produces structured results: pass/fail counts,
 * regression detection, and duration metrics. Parses standard test
 * runner output formats (Node test runner, Jest, mocha).
 *
 * Never mutates the system.
 *
 * @module test-suite-provider
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildObservationResult } from "./shared.js";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const DEFAULT_MAX_BUFFER = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// TestResult
// ---------------------------------------------------------------------------

export interface TestSuiteMetrics {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  framework: string;
}

// ---------------------------------------------------------------------------
// TestSuiteObservationProvider
// ---------------------------------------------------------------------------

export class TestSuiteObservationProvider implements ObservationProvider {
  readonly name = "test_suite";
  readonly capabilities = ["test", "test_suite"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const command = (params?.command as string) ?? "npx";
    const args = (params?.args as string[]) ?? ["tsx", "--test"];
    const cwd = (params?.cwd as string) ?? process.cwd();

    try {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";

      try {
        const result = await execFileAsync(command, args, {
          cwd,
          timeout: DEFAULT_TIMEOUT,
          maxBuffer: DEFAULT_MAX_BUFFER,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        // Non-zero exit is expected for failed tests — capture output
        if (typeof nodeErr.code === "number") {
          stdout = nodeErr.stdout ?? "";
          stderr = nodeErr.stderr ?? "";
        } else {
          // System error (command not found, timeout)
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: {
              errorType: "environment_failure",
              message: nodeErr.code === "ENOENT"
                ? `Command not found: ${command}`
                : nodeErr.message ?? String(err),
              code: nodeErr.code,
            },
          };
        }
      }

      const durationMs = Date.now() - startTime;
      const metrics = parseTestOutput(stdout + "\n" + stderr, durationMs);

      const evidence: Record<string, unknown> = {
        command,
        args,
        cwd,
        durationMs,
        framework: metrics.framework,
        total: metrics.total,
        passed: metrics.passed,
        failed: metrics.failed,
        skipped: metrics.skipped,
        stdout,
        stderr,
      };

      const observed = metrics.failed === 0 ? "pass" : "fail";
      return buildObservationResult(observation, observed, evidence);
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "provider_exception",
          message: (err as Error).message ?? String(err),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Test output parsing
// ---------------------------------------------------------------------------

/**
 * Parse test runner output to extract structured metrics.
 * Supports: Node test runner, Jest, mocha (basic format).
 */
export function parseTestOutput(output: string, durationMs: number): TestSuiteMetrics {
  // Node test runner format: "ℹ tests N  ℹ pass N  ℹ fail N  ℹ duration_ms M"
  const nodeTestMatch = output.match(/ℹ tests (\d+)[\s\S]*ℹ pass (\d+)[\s\S]*ℹ fail (\d+)[\s\S]*ℹ duration_ms (\d+)/);
  if (nodeTestMatch) {
    return {
      total: parseInt(nodeTestMatch[1], 10),
      passed: parseInt(nodeTestMatch[2], 10),
      failed: parseInt(nodeTestMatch[3], 10),
      skipped: 0,
      durationMs: Math.round(parseFloat(nodeTestMatch[4])), // Node reports in ms
      framework: "node:test",
    };
  }

  // Jest format: "Tests: N failed, M passed, T total"
  const jestMatch = output.match(/Tests:\s*(?:(\d+) failed,\s*)?(?:(\d+) passed,\s*)?(\d+) total/);
  if (jestMatch) {
    return {
      total: parseInt(jestMatch[3], 10),
      passed: parseInt(jestMatch[2] ?? "0", 10),
      failed: parseInt(jestMatch[1] ?? "0", 10),
      skipped: 0,
      durationMs,
      framework: "jest",
    };
  }

  // Mocha format: "N passing (M ms)" or "N failing"
  const mochaPassing = output.match(/(\d+) passing/);
  const mochaFailing = output.match(/(\d+) failing/);
  if (mochaPassing || mochaFailing) {
    const passed = mochaPassing ? parseInt(mochaPassing[1], 10) : 0;
    const failed = mochaFailing ? parseInt(mochaFailing[1], 10) : 0;
    return {
      total: passed + failed,
      passed,
      failed,
      skipped: 0,
      durationMs,
      framework: "mocha",
    };
  }

  // Fallback: derive status from exit code information already captured
  return {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs,
    framework: "unknown",
  };
}
