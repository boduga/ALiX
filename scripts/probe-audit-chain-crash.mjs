// Deterministic audit-chain crash-window probe.
// Simulates a crash AFTER the JSONL append+fsync but BEFORE the head sidecar
// update (the exact window between audit-chain-writer doAppend steps 9-10 and 11).
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "src");
const { AuditStore } = await import(
  pathToFileURL(path.join(distRoot, "governance/audit/audit-store.js")).href
);

const dir = mkdtempSync(path.join(tmpdir(), "audit-crash-"));
const headPath = path.join(dir, ".alix", "audit", "head.json");
const logPath = path.join(dir, ".alix", "audit", "audit.jsonl");

const store = new AuditStore(dir);
await store.activateIntegrity();
const a1 = await store.append({ action: "approval.approved", actor: "user", details: { approvalId: "a1" } });
const a2 = await store.append({ action: "approval.approved", actor: "user", details: { approvalId: "a2" } });
const headAfterA2 = readFileSync(headPath, "utf-8");
const a3 = await store.append({ action: "approval.approved", actor: "user", details: { approvalId: "a3" } });

// ── Simulate crash: JSONL has a3 committed, head rolled back to a2 ──
writeFileSync(headPath, headAfterA2);
const logLinesBefore = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean).length;

// Reopen (fresh process would do the same) and continue with NO manual repair.
const store2 = new AuditStore(dir);
const beforeRecovery = await store2.verifyIntegrity();
const a4 = await store2.append({ action: "approval.approved", actor: "user", details: { approvalId: "a4" } });

const logLinesAfter = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean).length;
const seqs = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean)
  .map((l) => { try { return JSON.parse(l).seq; } catch { return "malformed"; } });
const afterRecovery = await store2.verifyIntegrity();

console.log(JSON.stringify({
  a1Seq: a1.seq, a2Seq: a2.seq, a3Seq: a3.seq,
  logLinesBefore, logLinesAfter,
  a4Seq: a4.seq,
  duplicateSeq: a4.seq === a3.seq,
  allSeqs: seqs,
  // Verification BEFORE the recovery append legitimately reports the injected
  // stale head; verification AFTER must be clean (chain not corrupted).
  beforeRecoveryOk: beforeRecovery.ok,
  beforeRecoveryFindings: beforeRecovery.findings,
  afterRecoveryOk: afterRecovery.ok,
  afterRecoveryFindings: afterRecovery.findings,
}, null, 2));
rmSync(dir, { recursive: true, force: true });
