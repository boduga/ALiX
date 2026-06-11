import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { box, green, yellow, red, dim, bold, truncate, pad, formatAge, statusDot, bar } from "../../src/tui/box.js";
import { renderDashboardCards, snapshotFromStore } from "../../src/tui/dashboard-renderer.js";
import type { TuiRuntimeSnapshot } from "../../src/tui/runtime-snapshot.js";
import type { TuiState } from "../../src/tui/store.js";

describe("box helpers", () => {
  it("truncate shortens long strings", () => {
    assert.equal(truncate("hello world", 6), "hello…");
  });

  it("truncate leaves short strings unchanged", () => {
    assert.equal(truncate("hi", 5), "hi");
  });

  it("pad fills to width", () => {
    assert.equal(pad("ab", 4), "ab  ");
  });

  it("pad truncates if over width", () => {
    assert.equal(pad("abcdef", 4), "abcd");
  });

  it("green wraps in ANSI", () => {
    const r = green("ok");
    assert.ok(r.includes("\x1b[32m"));
    assert.ok(r.includes("\x1b[0m"));
  });

  it("red wraps in ANSI", () => {
    assert.ok(red("err").includes("\x1b[31m"));
  });

  it("yellow wraps in ANSI", () => {
    assert.ok(yellow("warn").includes("\x1b[33m"));
  });

  it("dim wraps in ANSI", () => {
    assert.ok(dim("muted").includes("\x1b[2m"));
  });

  it("bold wraps in ANSI", () => {
    assert.ok(bold("title").includes("\x1b[1m"));
  });

  it("formatAge shows seconds", () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    assert.match(formatAge(ts), /\d+s/);
  });

  it("statusDot shows green for running", () => {
    assert.ok(statusDot("running").includes("\x1b[32m"));
  });

  it("statusDot shows red for failed", () => {
    assert.ok(statusDot("failed").includes("\x1b[31m"));
  });

  it("bar renders filled and empty", () => {
    const r = bar(50, 10);
    assert.ok(r.includes("█"));
    assert.ok(r.includes("░"));
  });

  it("box renders consistent borders", () => {
    const lines = box("TEST", ["line 1", "line 2"], 20);
    assert.ok(lines[0].startsWith("┌"));
    assert.ok(lines[lines.length - 1].startsWith("└"));
    assert.equal(lines.length, 4); // top + 2 content + bottom
  });
});

describe("dashboard-renderer", () => {
  const baseSnapshot: TuiRuntimeSnapshot = {
    daemonRunning: true,
    daemonPid: 12345,
    daemonHeartbeatAge: 5,
    daemonTasks: { queued: 1, running: 2, completed: 10, failed: 0, cancelled: 0, failedOrphaned: 0 },
    daemonTaskRecords: [],
    pendingApprovalsCount: 1,
    pendingApprovalRecords: [{ id: "app_1", capability: "shell.exec", reason: "test", createdAt: new Date().toISOString() }],
    resolvedApprovalsCount: 0,
    resolvedApprovalRecords: [],
    continuationsCount: 0,
    sopsCount: 2,
    sopItems: [{ id: "research.deep_report", name: "Deep Research", nodeCount: 6 }],
    policyRulesCount: 11,
    runtimeEventCount: 100,
    recentRuntimeEvents: [{ id: "e1", action: "tool.completed", source: "session", summary: "ok" }],
  };

  it("renders daemon card with running state", () => {
    const cards = renderDashboardCards(baseSnapshot, 120);
    const joined = cards.join("\n");
    assert.ok(joined.includes("DAEMON"), `Expected DAEMON card, got: ${joined.slice(0, 200)}`);
    assert.ok(joined.includes("running"), `Expected running status, got: ${joined.slice(0, 200)}`);
  });

  it("renders stopped daemon", () => {
    const stopped = { ...baseSnapshot, daemonRunning: false };
    const cards = renderDashboardCards(stopped, 120);
    assert.ok(cards.join("\n").includes("stopped"));
  });

  it("renders approval data", () => {
    const cards = renderDashboardCards(baseSnapshot, 120);
    const joined = cards.join("\n");
    assert.ok(joined.includes("Pending"));
    assert.ok(joined.includes("app_1") || joined.includes("shell.exec"));
  });

  it("renders runtime events", () => {
    const cards = renderDashboardCards(baseSnapshot, 120);
    assert.ok(cards.join("\n").includes("tool.completed"));
  });

  it("renders SOP/policy card", () => {
    const cards = renderDashboardCards(baseSnapshot, 120);
    const joined = cards.join("\n");
    assert.ok(joined.includes("SOPS") || joined.includes("research"));
    assert.ok(joined.includes("Rules") || joined.includes("POLICY"));
  });

  it("snapshotFromStore builds from state", () => {
    const state: Partial<TuiState> = {
      daemonRunning: true,
      sopsCount: 3,
      policyRulesCount: 11,
    };
    const snap = snapshotFromStore(state as TuiState);
    assert.equal(snap.daemonRunning, true);
    assert.equal(snap.sopsCount, 3);
    assert.equal(snap.policyRulesCount, 11);
  });
});
