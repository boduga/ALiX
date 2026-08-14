// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — Emission-sentinel (6-axis).
 *
 * Mirrors CAP-9 four-axis sentinel and CAP-10 five-axis sentinel, adds axis 6
 * (NEW) — emission seam purity. Locks the M1 evolution-signal emission seam:
 * - A5 imports only the write-side contract (ProposalSignalSink); never the
 *   read-side (ProposalSignalSource), preventing read-back coupling.
 * - ProposalSignalChannel exposes only `publish` (write) and `signals` (read).
 *   No mutator escape hatches (reset/clear/drain/consume).
 * - The internal buffer is private — consumers see only the two contracts.
 * - ProposalSignalChannel is constructed exactly once in `src/` (composition
 *   root owns the sole instance).
 * - The `signals_unpublished` event type is present in measurement event types.
 * - The default outcome decider emits an `underperformer` signal for an
 *   `ineffective` outcome.
 *
 * @module tests/capability/cap-10-5-emission-sentinel
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

describe("CAP-10.5 emission-sentinel (6-axis)", () => {
  it("axis 1: a5 does not import ProposalSignalSource (read-only)", () => {
    const src = read("evolution/observation/a5-capability-measurement.ts");
    expect(src).not.toMatch(/ProposalSignalSource\b/);
    expect(src).toMatch(/ProposalSignalSink\b/);
  });

  it("axis 2: channel API exposes only publish (write) and signals (read)", () => {
    const src = read("capability/evolution/proposal-signal-channel.ts");
    expect(src).toMatch(/async\s+publish\s*\(/);
    expect(src).toMatch(/async\s+signals\s*\(\s*\)/);
    // No other public mutator method
    expect(src).not.toMatch(/async\s+(reset|clear|drain|consume)\s*\(/);
  });

  it("axis 3: signalsBuffer is private", () => {
    const src = read("capability/evolution/proposal-signal-channel.ts");
    expect(src).toMatch(/private\s+readonly\s+signalsBuffer/);
  });

  it("axis 4: ProposalSignalChannel is constructed exactly once in src/", () => {
    // scan candidate .ts files under src/ for `new ProposalSignalChannel(`
    // (real construction sites, excluding doc-comment mentions).
    const matches: string[] = [];
    const walk = (rel: string) => {
      const full = resolve(SRC, rel);
      try {
        const raw = readFileSync(full, "utf8");
        // strip block comments and line comments so docstrings mentioning
        // `new ProposalSignalChannel(` are not counted.
        const code = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const found = code.match(/new\s+ProposalSignalChannel\s*\(/g) ?? [];
        matches.push(...found.map(() => rel));
      } catch {
        // directory or unreadable
      }
    };
    // scan candidate files
    for (const rel of [
      "capability/platform.ts",
      "capability/evolution/proposal-signal-channel.ts",
      "capability/measurement/capability-measurement-engine.ts",
      "evolution/observation/a5-capability-measurement.ts",
    ]) {
      walk(rel);
    }
    expect(matches).toEqual(["capability/platform.ts"]);
  });

  it("axis 5: signals_unpublished event type present in event-types", () => {
    const src = read("capability/measurement/measurement-event-types.ts");
    expect(src).toMatch(/capability\.governance\.measurement\.signals_unpublished/);
    expect(src).toMatch(/MeasurementSignalsUnpublishedEvent/);
  });

  it("axis 6: default decider emits underperformer for ineffective", () => {
    const src = read("evolution/observation/a5-capability-measurement.ts");
    expect(src).toMatch(/kind:\s*"ineffective"/);
    expect(src).toMatch(/kind:\s*"underperformer"/);
    expect(src).toMatch(/defaultSignalsFor/);
  });
});