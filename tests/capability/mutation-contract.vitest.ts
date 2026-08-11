// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  isLegalTransition,
} from "../../src/capability/mutation-contract.js";
import type { LifecycleState } from "../../src/adaptation/capability-evolution-types.js";

const ALL_STATES: readonly LifecycleState[] = [
  "emerging", "active", "mature", "stagnant", "declining", "deprecated",
];

describe("LEGAL_LIFECYCLE_TRANSITIONS (#481 locked graph)", () => {
  it("covers exactly the six lifecycle states", () => {
    expect(Object.keys(LEGAL_LIFECYCLE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it("encodes the exact locked edge set", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.emerging).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.active).toEqual(["mature", "declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.mature).toEqual(["declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.stagnant).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.declining).toEqual(["deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toEqual([]);
  });

  it("has deprecated as a terminal state (no outgoing edges)", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toHaveLength(0);
  });

  it("is acyclic (no state can reach itself)", () => {
    for (const from of ALL_STATES) {
      const frontier = [...LEGAL_LIFECYCLE_TRANSITIONS[from]];
      const seen = new Set(frontier);
      while (frontier.length > 0) {
        const cur = frontier.pop()!;
        expect(cur).not.toBe(from);
        for (const next of LEGAL_LIFECYCLE_TRANSITIONS[cur]) {
          if (!seen.has(next)) { seen.add(next); frontier.push(next); }
        }
      }
    }
  });
});

describe("isLegalTransition", () => {
  it("accepts every legal edge from the locked graph", () => {
    expect(isLegalTransition("emerging", "active")).toBe(true);
    expect(isLegalTransition("emerging", "deprecated")).toBe(true);
    expect(isLegalTransition("active", "mature")).toBe(true);
    expect(isLegalTransition("active", "declining")).toBe(true);
    expect(isLegalTransition("mature", "declining")).toBe(true);
    expect(isLegalTransition("stagnant", "active")).toBe(true);
    expect(isLegalTransition("stagnant", "deprecated")).toBe(true);
    expect(isLegalTransition("declining", "deprecated")).toBe(true);
  });

  it("rejects edges not in the locked graph", () => {
    expect(isLegalTransition("active", "deprecated")).toBe(false); // #481: no active→deprecated
    expect(isLegalTransition("emerging", "mature")).toBe(false);
    expect(isLegalTransition("mature", "active")).toBe(false);
    expect(isLegalTransition("declining", "active")).toBe(false);
    expect(isLegalTransition("deprecated", "active")).toBe(false); // terminal
    expect(isLegalTransition("deprecated", "deprecated")).toBe(false);
  });

  it("rejects self-loops", () => {
    expect(isLegalTransition("active", "active")).toBe(false);
    expect(isLegalTransition("emerging", "emerging")).toBe(false);
  });

  it("is complete: every (from, to) not in the table is illegal", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
        expect(isLegalTransition(from, to)).toBe(expected);
      }
    }
  });
});
