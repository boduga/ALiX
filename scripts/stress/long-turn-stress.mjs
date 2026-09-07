#!/usr/bin/env node
// scripts/stress/long-turn-stress.mjs
//
// LONG-RUNNING TURN STRESS RUNNER (manual / opt-in ONLY — never runs in CI)
//
// PURPOSE
//   Real-run artifact for Phase 8 of docs/superpowers/plans/
//   2026-09-06-alix-live-response-activity-implementation-plan.md:
//   "Run the actual stress test again … Crossing 120 seconds must no longer
//   terminate the invocation", then "test an intentionally broken provider to
//   verify that the watchdog can report lack of progress without silently
//   hanging forever."
//
//   The deterministic fake-clock suite (tests/run/long-running-turn.vitest.ts,
//   Tests 7.1-7.10) proves the boundary without waiting real seconds. This
//   script is the complementary REAL-WALL-CLOCK artifact: it drives a genuine
//   agent turn against a real provider and prints the live activity elapsed
//   ("Thinking… 30s" → … → "Thinking… 2m 30s") as it crosses each milestone,
//   then asserts the invocation survived past 120 seconds and completed.
//
//   Because every real provider routes its chat traffic through a hard-coded
//   spec base URL (src/providers/specs/* — e.g. DeepSeek → api.deepseek.com)
//   there is no code-free way to point the default cloud provider at a black
//   hole. `--broken-provider` therefore spins up a local OpenAI-compatible
//   BLACK-HOLE endpoint on localhost:8080 — the exact fixed chat endpoint of
//   the local-llama spec (src/providers/specs/local-llama-spec.ts) — answers
//   the launcher's GET /v1/models probe, then swallows every
//   /v1/chat/completions POST without ever responding. The built-in
//   `local-llama` provider is pinned to it via a scratch project config, and
//   the run verifies the liveness WATCHDOG flags POSSIBLY_STALLED (~2 min of
//   real silence) and that operator cancellation ends the turn as Cancelled —
//   never a hang, never a timeout.
//
// USAGE (from the repo root; `pnpm build` first):
//   pnpm stress:long-turn -- --task "<long generation task>" [--no-plan]
//   pnpm stress:long-turn -- --broken-provider [--broken-wait-ms 240000]
//   pnpm stress:long-turn -- --help
//
//   Normal mode runs against the model configured in your active ALiX config
//   (models.default) from `--cwd` (default: current dir). Whether it actually
//   crosses 120 s depends on provider latency + task weight — if the provider
//   answers sooner the run reports FAIL (did not cross) so the operator knows
//   the boundary was not exercised, and can rerun with a heavier task /
//   reasoning model.
//
// EXIT CODES
//   0  PASS
//   1  FAIL (assertion failed / run errored)
//   2  inconclusive (normal mode: provider answered before 120 s; prompt did
//      not enter the activity path; etc.)
//   3  environment error (dist not built, no model configured)

import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// ─── Argument parsing ───────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const HELP = ARGS.includes("--help") || ARGS.includes("-h");
const BROKEN = ARGS.includes("--broken-provider");
// Planning is off by default: this tool exercises the AGENT-turn model
// generation + liveness watchdog (the surface with the live-activity wiring),
// and an interactive plan-approval prompt would block a script. `--plan`
// opts back into the plan phase.
const WITH_PLAN = ARGS.includes("--plan");
const CWD = argValue("--cwd", process.cwd());
const BROKEN_WAIT_MS = Number(argValue("--broken-wait-ms", "240000"));
const MAX_RUN_MS = Number(argValue("--max-run-ms", "900000"));
const TASK =
  argValue("--task", "") ||
  (BROKEN
    ? "Produce a report and save it to stress-report.md in the current directory. The report must have five parts and be extremely detailed."
    : "Produce a very long, deeply detailed five-part technical report (architecture, design, implementation, testing, operations) and save it to stress-report.md in the current directory. Take your time and be exhaustive — every section must be complete and thoroughly explained. Do not stop until all five parts are written out in full.");

function argValue(name, fallback) {
  const i = ARGS.indexOf(name);
  return i !== -1 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : fallback;
}

const USAGE = `long-turn-stress — Phase 8 real-run artifact for the live-response activity plan.

Usage:
  node scripts/stress/long-turn-stress.mjs [--task "<task>"] [--plan] [--cwd <dir>] [--max-run-ms <n>]
  node scripts/stress/long-turn-stress.mjs --broken-provider [--broken-wait-ms <n>]

Options:
  --task <text>          Task to run (normal mode). Defaults to a five-part
                         report prompt that historically crosses 120 s on a
                         reasoning model.
  --plan                 Run the plan phase (off by default so the script never
                         blocks on an interactive plan-approval prompt).
  --cwd <dir>            Directory to run from (config + sessions). Default: cwd.
  --max-run-ms <n>       Hard cap for a normal-mode run (default 900000).
  --broken-provider      Drive the built-in local-llama provider against a local
                         black-hole endpoint and verify the liveness watchdog
                         reports POSSIBLY_STALLED, then operator cancellation
                         ends the turn as Cancelled (~2+ real minutes).
  --broken-wait-ms <n>   How long to wait for the stall warning (default 240000).
  -h, --help             Show this help.

Prereqs: \`pnpm build\` (script imports dist/src), a configured default model
(normal mode), and real minutes. Never runs in CI.
`;

if (HELP) {
  console.log(USAGE);
  process.exit(0);
}

// ─── Dist availability ─────────────────────────────────────────────────────
const SESSION_ENTRY = join(ROOT, "dist", "src", "agent", "session.js");
if (!existsSync(SESSION_ENTRY)) {
  console.error("FAIL(env): dist build missing — run `pnpm build` first.");
  process.exit(3);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const ACTIVITY_LABELS = {
  thinking: "Thinking…",
  waiting_for_provider: "Thinking…",
  tool_running: "Running tool…",
  verifying: "Verifying…",
  summarizing: "Summarizing…",
  possibly_stalled: "Still working…",
  cancelling: "Cancelling…",
};

function milestoneLine(state, elapsedMs) {
  const label = ACTIVITY_LABELS[state];
  if (!label) return undefined;
  return `  ◐ ${label} ${formatElapsed(elapsedMs)}`;
}

// ─── Broken-provider black-hole server ─────────────────────────────────────
// The local-llama provider (the one real provider whose chat traffic we can
// target without a source change) sends every request to the local-llama
// SPEC's fixed base URL — http://localhost:8080/v1/chat/completions
// (src/providers/specs/local-llama-spec.ts). Its env-configurable
// ALIX_LLAMA_BASE_URL only feeds the launcher's health probe, NOT the chat
// call, so the black hole must occupy exactly that fixed endpoint. It
// answers the launcher's GET /v1/models probe and then swallows every
// /v1/chat/completions POST without ever responding.
const BLACK_HOLE_PORT = 8080;

function startBlackHoleServer() {
  const held = new Set();
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "black-hole", object: "model", owned_by: "stress-runner" }],
        }),
      );
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      // Intentionally non-progressing: accept the request and never respond.
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(BLACK_HOLE_PORT, () => {
      server.removeAllListeners("error");
      resolve({
        baseUrl: `http://localhost:${BLACK_HOLE_PORT}/v1/chat/completions`,
        async close() {
          for (const res of held) res.destroy();
          held.clear();
          await new Promise((r) => server.close(r));
        },
      });
    });
  });
}

function makeBrokenCwd() {
  const dir = join(tmpdir(), `alix-stress-broken-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, ".alix", "sessions"), { recursive: true });
  // Pin models.default to the built-in local-llama provider (whose chat
  // traffic targets the black hole on localhost:8080), with transport bounds
  // raised well past the 120 s watchdog warning window so the watchdog — not
  // the transport idle/total timeout — fires first.
  writeFileSync(
    join(dir, ".alix", "config.json"),
    JSON.stringify(
      {
        models: {
          default: {
            provider: "local-llama",
            name: "black-hole",
            streaming: true,
            timeoutMs: 900000,
            streamIdleTimeoutMs: 900000,
          },
        },
        permissions: { sessionMode: "auto" },
      },
      null,
      2,
    ),
  );
  return dir;
}

// ─── Core: drive one real turn with a live-activity monitor ────────────────
async function runTurn({ cwd, task, withPlan, broken, brokenWaitMs, maxRunMs }) {
  const { createAgentSession } = await import(
    join(ROOT, "dist", "src", "agent", "session.js")
  );
  const { ExecutionCancelledError } = await import(
    join(ROOT, "dist", "src", "runtime", "cancellation-token.js")
  );

  const session = createAgentSession({
    cwd,
    task,
    planMode: withPlan ? undefined : false,
    sessionMode: broken ? "auto" : undefined,
  });

  const startedAt = Date.now();
  const milestones = [1, 30, 60, 90, 120, 150, 180, 210, 240, 300];
  let printed = 0;
  let sawStall = false;
  let firstActivityAt = undefined;
  let terminal = undefined;

  const turn = (async () => {
    try {
      const result = await session.processTurn(task);
      terminal = { kind: "completed", result };
      return result;
    } catch (err) {
      terminal = {
        kind:
          err instanceof ExecutionCancelledError || err?.name === "ExecutionCancelledError"
            ? "cancelled"
            : "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  })();

  // Monitor loop: print the live activity line at each milestone while the
  // turn is still in flight.
  while (terminal === undefined && Date.now() - startedAt < maxRunMs) {
    const activity = session.getActivity?.();
    if (activity) {
      firstActivityAt ??= activity.startedAt;
      const elapsedMs = Date.now() - activity.startedAt;
      if (activity.state === "possibly_stalled") sawStall = true;
      while (printed < milestones.length && elapsedMs >= milestones[printed] * 1000) {
        const line = milestoneLine(activity.state, elapsedMs);
        if (line) console.log(line);
        printed++;
      }
    }
    if (broken && sawStall) {
      // Watchdog reported the stall — stop waiting and let the caller cancel.
      break;
    }
    await sleep(250);
  }

  if (broken) {
    // The watchdog should have flagged POSSIBLY_STALLED within brokenWaitMs.
    // Whichever happens first — stall observed, run errored, or the cap —
    // operator-cancel so the run provably unwinds (never hangs forever).
    if (!sawStall && terminal === undefined && Date.now() - startedAt < brokenWaitMs) {
      // Keep waiting for the watchdog up to brokenWaitMs.
      while (terminal === undefined && !sawStall && Date.now() - startedAt < brokenWaitMs) {
        const activity = session.getActivity?.();
        if (activity?.state === "possibly_stalled") sawStall = true;
        await sleep(250);
      }
    }
    // Always cancel once the stall is observed (or the wait budget is spent):
    // a stall is diagnostic, never terminal — cancellation is what ends it.
    if (terminal === undefined) {
      const cancelled = session.cancelActiveTurn?.("stress:broken-provider");
      console.log(`  [broken] cancelActiveTurn → ${cancelled ? "armed" : "no-op"}`);
    }
  } else if (terminal === undefined) {
    // Normal-mode max-run cap hit while the turn is still pending: cancel so
    // the manual tool can never hang indefinitely (a bounded FAIL is better
    // than an unbounded wait).
    session.cancelActiveTurn?.("stress:max-run-cap");
    console.log(`  [normal] max-run cap of ${maxRunMs}ms hit — cancelled to stay bounded.`);
  }

  // Await the turn — but BOUNDED: after the broken-mode cancel or the
  // normal-mode max-run cap the turn is expected to unwind in seconds; if it
  // somehow does not, report that rather than hanging the manual tool forever.
  const settleWindowMs = 90_000;
  const turnGuard = turn.then(
    () => terminal ?? { kind: "completed", result: null },
    (err) =>
      terminal ?? {
        kind: "failed",
        error: err instanceof Error ? err.message : String(err),
      },
  );
  const settleProbe = (async () => {
    await sleep(settleWindowMs);
    return {
      kind: "unsettled",
      error: `turn did not unwind within ${Math.round(settleWindowMs / 1000)}s of the cap/cancel (still pending)`,
    };
  })();
  if (process.env.ALIX_STRESS_DEBUG) {
    // While the settle window runs, report the live activity/liveness so a
    // stuck unwind can be diagnosed without guessing.
    (async () => {
      for (let i = 0; i < 20; i++) {
        await sleep(3000);
        const a = session.getActivity?.();
        const l = session.getLiveness?.();
        const now = Date.now() - startedAt;
        console.log(
          `  [debug ${Math.round(now / 1000)}s] activity=${a?.state ?? "none"} liveness=${l?.state ?? "none"} idleMs=${Math.round(l?.idleMs ?? 0)}`,
        );
      }
    })();
  }
  const outcome = await Promise.race([turnGuard, settleProbe]);
  // Swallow the eventual settle of a still-pending turn so it can never crash
  // the process as an unhandled rejection after we reported "unsettled".
  turnGuard.catch(() => {});
  const totalMs = Date.now() - startedAt;
  const result = outcome.result;
  return {
    session,
    outcome,
    totalMs,
    sawStall,
    firstActivityAt,
    result,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (BROKEN) {
    console.log("long-turn-stress: BROKEN-PROVIDER mode (real watchdog, ~2+ real minutes)");
    console.log(`  requires localhost:${BLACK_HOLE_PORT} to be free (local-llama spec's fixed chat endpoint)`);
    let blackHole;
    let brokenCwd;
    try {
      try {
        blackHole = await startBlackHoleServer();
      } catch (err) {
        console.error(`FAIL(env): could not bind black-hole server on localhost:${BLACK_HOLE_PORT} — is a llama-server already running there? (${err.code ?? err.message})`);
        process.exitCode = 3;
        return;
      }
      brokenCwd = makeBrokenCwd();
      console.log(`  black-hole endpoint: ${blackHole.baseUrl}`);
      const r = await runTurn({
        cwd: brokenCwd,
        task: TASK,
        withPlan: false,
        broken: true,
        brokenWaitMs: BROKEN_WAIT_MS,
        maxRunMs: BROKEN_WAIT_MS + 30000,
      });
      const kind = r.outcome?.kind;
      const cancelSummary = r.session.getLastCancelSummary?.();
      console.log("");
      console.log(`  elapsed: ${formatElapsed(r.totalMs)}`);
      console.log(`  outcome kind: ${kind}`);
      if (cancelSummary) console.log(`  cancel summary: ${cancelSummary}`);
      const passed = r.sawStall && kind === "cancelled";
      if (passed) {
        console.log("PASS: watchdog reported POSSIBLY_STALLED and operator cancel unwound the turn as Cancelled — no hang, no timeout.");
        process.exitCode = 0;
      } else {
        console.error(`FAIL: expected sawStall=true + cancelled, got sawStall=${r.sawStall} kind=${kind} (bounded=${r.totalMs < BROKEN_WAIT_MS + 30000}ms).`);
        process.exitCode = 1;
      }
    } finally {
      if (blackHole) await blackHole.close();
      if (brokenCwd) rmSync(brokenCwd, { recursive: true, force: true });
    }
    // The cancelled turn may leave an orphaned in-flight fetch to the black
    // hole; force-exit shortly after stdout drains so the tool never lingers.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
    return;
  }

  // Normal mode: real provider from the active config.
  console.log(`long-turn-stress: NORMAL mode (real provider, real minutes)`);
  const { loadConfig } = await import(join(ROOT, "dist", "src", "config", "loader.js"));
  const { tryResolveModelConfig } = await import(
    join(ROOT, "dist", "src", "config", "model-resolver.js")
  );
  let config;
  try {
    config = await loadConfig(CWD);
  } catch (err) {
    console.error(`FAIL(env): could not load config at ${CWD}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 3;
    return;
  }
  const model = tryResolveModelConfig(config);
  if (!model?.provider || !model?.name) {
    console.error("FAIL(env): no models.default configured. Run `alix models set-default <provider> <model>` first.");
    process.exitCode = 3;
    return;
  }
  console.log(`  cwd:    ${CWD}`);
  console.log(`  model:  ${model.provider}/${model.name}`);
  console.log(`  task:   ${TASK.slice(0, 90)}${TASK.length > 90 ? "…" : ""}`);
  console.log("  watching live activity — provider must run past 120s to PASS.\n");

  const r = await runTurn({
    cwd: CWD,
    task: TASK,
    withPlan: WITH_PLAN,
    broken: false,
    maxRunMs: MAX_RUN_MS,
  });
  console.log("");
  const kind = r.outcome?.kind;
  console.log(`  outcome kind: ${kind}`);
  console.log(`  elapsed: ${formatElapsed(r.totalMs)}`);
  if (kind === "completed") {
    const summary = r.result?.summary ?? "";
    console.log(`  summary: ${summary.slice(0, 160)}${summary.length > 160 ? "…" : ""}`);
  } else {
    console.log(`  error: ${r.outcome?.error ?? "unknown"}`);
  }

  const crossed = r.totalMs >= 120000;
  const exercisedActivity = r.firstActivityAt !== undefined;
  if (kind === "completed" && crossed && exercisedActivity) {
    console.log("PASS: the invocation crossed 120s and completed normally — the old wall-clock deadline is gone.");
    process.exitCode = 0;
  } else if (!exercisedActivity) {
    console.error("FAIL(inconclusive): no live activity was observed — the prompt did not enter the agent/activity path. Use a tool/file-output task.");
    process.exitCode = 2;
  } else if (kind === "completed" && !crossed) {
    console.error("FAIL(inconclusive): the provider answered before 120s, so the boundary was not exercised. Rerun with a heavier task / reasoning model, or a slower provider window.");
    process.exitCode = 2;
  } else {
    console.error(`FAIL: expected a completed run past 120s; got kind=${kind}.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAIL(unexpected):", err);
  process.exitCode = 1;
});
