/**
 * Measures the F7 disagreement over the branch's OWN recorded sessions.
 *
 * Run manually, not part of the gate: it reads whatever `.alix/sessions`
 * happens to contain, so its output is evidence, not an assertion.
 *
 *   node scripts/measure-iteration-accounting.mjs [sessionsRoot]
 *
 * Reports, per session, the three counts that T3 finding 7 says disagree:
 *
 *   decisions  `agent.decision` — emitted only when the model CALLS TOOLS, so
 *              a pure-prose turn contributes zero
 *   assembled  `context.assembled` — once per model-facing turn
 *   messages   `agent.message` — once per assistant PROSE message
 *   reported   `session.ended` contextPressure.totalIterations, the loop's
 *              own count, which `extractSessionOutcome` now prefers
 *
 * `reported` is absent on older traces, which is why the extractor keeps the
 * message tally as a fallback.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".alix/sessions";
if (!existsSync(root)) {
  console.error(`no sessions directory at ${root}`);
  process.exit(1);
}

const sessions = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join(root, entry.name))
  .filter(dir => existsSync(join(dir, "events.jsonl")));

const rows = [];
for (const dir of sessions) {
  const lines = readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean);
  let decisions = 0, assembled = 0, messages = 0, reported = null;
  for (const line of lines) {
    if (line.includes('"agent.decision"')) decisions++;
    else if (line.includes('"context.assembled"')) assembled++;
    else if (line.includes('"agent.message"')) messages++;
    else if (line.includes('"session.ended"')) {
      try {
        const total = JSON.parse(line).payload?.contextPressure?.totalIterations;
        if (Number.isInteger(total) && total > 0) reported = total;
      } catch { /* malformed line: counted nowhere */ }
    }
  }
  if (Math.max(decisions, assembled, messages, reported ?? 0) > 0) {
    rows.push({ id: dir.split("/").pop().slice(0, 8), decisions, assembled, messages, reported });
  }
}

const mean = key => {
  const values = rows.map(r => r[key]).filter(v => typeof v === "number");
  return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "n/a";
};

console.log(`${rows.length} sessions with activity\n`);
console.log("session    decisions  assembled  messages  reported");
for (const row of rows) {
  console.log(
    `${row.id.padEnd(10)} ${String(row.decisions).padStart(9)} ${String(row.assembled).padStart(9)}`
    + ` ${String(row.messages).padStart(8)} ${String(row.reported ?? "-").padStart(9)}`,
  );
}

console.log(`\nmean:      ${mean("decisions").padStart(9)} ${mean("assembled").padStart(9)} ${mean("messages").padStart(8)} ${mean("reported").padStart(9)}`);

const disagree = (a, b) => rows.filter(r => typeof r[b] === "number" && r[a] !== r[b]).length;
const withReported = rows.filter(r => typeof r.reported === "number").length;
console.log(`\ndecisions vs assembled: ${disagree("decisions", "assembled")}/${rows.length} sessions differ`);
console.log(`messages  vs assembled: ${disagree("messages", "assembled")}/${rows.length} sessions differ`);
if (withReported) {
  const residual = rows.filter(r => r.reported !== null && r.assembled !== r.reported);
  console.log(`assembled vs reported:  ${residual.length}/${withReported} sessions differ`
    + (residual.length ? ` (${residual.map(r => r.id).join(", ")})` : ""));
  if (residual.length) {
    console.log(
      "\n  The residual is explained, not unexplained: `contextPressure` is created\n"
      + "  per runTaskLoop, so a RESUMED session's `session.ended` reports the last\n"
      + "  run's iteration count while `context.assembled` accumulates every run in\n"
      + "  the session file. `reported` is authoritative for the run that ended, and\n"
      + "  is a lower bound for the session as a whole. Worth knowing before treating\n"
      + "  it as a session total.",
    );
  }
}

console.log(
  "\n`decisions` under-counts by construction (no tools called = no event), and\n"
  + "`messages` counts prose rather than turns. `reported` is the loop's own\n"
  + "count and is what extractSessionOutcome now prefers.",
);
