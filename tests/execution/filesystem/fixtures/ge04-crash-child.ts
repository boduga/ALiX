import { recordGe04Attempt } from "../../../../src/execution/filesystem/ge04-attempt-journal.js";
const root = process.argv[2];
if (!root) throw new Error("workspace root required");
const id = await recordGe04Attempt({
  workspaceRoot: root, ownedScope: "owned", workerId: "worker-crash",
  leaseId: "lease-crash", approvalId: "approval-crash", policyRevision: "revision-crash",
}, { kind: "create", relativePath: "crash.txt", content: Buffer.from("crash") });
if (!process.send) throw new Error("IPC required");
process.send({ attemptId: id });
setInterval(() => {}, 1000);
